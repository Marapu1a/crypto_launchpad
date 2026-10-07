// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPonsFactory, IPonsCurve, IPonsHook} from "./IPonsVenue.sol";

interface IPonsEscrow {
    function balanceOfToken(address recipient, address token) external view returns(uint256);
    function claimToken(address token) external;
}
interface IPonsPromo {
    function projectToken() external view returns(address);
    function quoteToken() external view returns(address);
    function syncUSDG() external;
}

/// @notice Local Pons escrow integration prototype, NOT deployment-admitted.
/// Sweep/operator adapters are deliberately separate from already-earned claims.
contract LocalPonsCollector is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Policy { uint64 endsAt; address[3] recipients; uint16[3] bps; }
    address public immutable projectToken;
    address public immutable quoteToken;
    address public immutable escrow;
    bytes32 public immutable escrowCodeHash;
    address public promoVault;
    address public factory;
    address public curve;
    address public hook;
    bytes32 public poolId;
    bytes32 public venueCodeHash;

    uint64 public campaignId;
    uint256 public accounted;
    mapping(uint64 => Policy) private policies;
    mapping(uint64 => uint256) public received;
    mapping(address => uint256) public credit;
    error InvalidConfiguration();
    error AlreadyBound();
    error NotBound();
    error SourceDrift();
    error BalanceDeficit();
    error IncompleteClaim();
    error CampaignActive();
    error StaleCampaign();
    error WrongPhase();
    error AwaitingOperator();
    event VenueBound(address factory,address curve,address hook,bytes32 poolId);
    event Swept(uint8 phase);
    event SourceBound(address indexed vault, bytes32 fingerprint);
    event CampaignOpened(uint64 indexed id, uint64 endsAt, address[3] recipients, uint16[3] bps);
    event CampaignClosed(uint64 indexed id, uint256 revenue);
    event RevenueRecognized(uint64 indexed id, uint256 amount);
    event Credited(uint64 indexed id, address indexed recipient, uint256 amount);
    event Claimed(uint256 amount);
    event Paid(address indexed recipient, uint256 amount);

    constructor(address owner_, address token, address quote, address escrow_) Ownable(owner_) {
        if(token==address(0)||token==quote||quote.code.length==0||escrow_.code.length==0)
            revert InvalidConfiguration();
        projectToken=token; quoteToken=quote; escrow=escrow_; escrowCodeHash=escrow_.codehash;
    }
    function policy(uint64 id) external view returns(Policy memory) { return policies[id]; }
    function bindVenue(address factory_) external onlyOwner nonReentrant {
        _checkSource();
        if(factory!=address(0)) revert AlreadyBound();
        if(factory_.code.length==0) revert InvalidConfiguration();
        factory=factory_;
        IPonsFactory.Launch memory l=IPonsFactory(factory).getLaunchedToken(projectToken);
        curve=l.curve; hook=IPonsFactory(factory).memeHook();
        if(curve.code.length==0||hook.code.length==0) revert InvalidConfiguration();
        poolId=_poolId(l); venueCodeHash=_venueHash();
        _checkVenue(); emit VenueBound(factory,curve,hook,poolId);
    }
    function _poolId(IPonsFactory.Launch memory l) private view returns(bytes32) {
        (address a,address b)=projectToken<quoteToken?(projectToken,quoteToken):(quoteToken,projectToken);
        return keccak256(abi.encode(a,b,l.poolFee,l.tickSpacing,hook));
    }
    function _venueHash() private view returns(bytes32) {
        return keccak256(abi.encode(factory.codehash,curve.codehash,hook.codehash));
    }
    function _checkVenue() private view returns(uint8 phase) {
        _checkSource();
        if(factory==address(0)) revert NotBound();
        if(_venueHash()!=venueCodeHash) revert SourceDrift();
        IPonsFactory f=IPonsFactory(factory);
        IPonsFactory.Launch memory l=f.getLaunchedToken(projectToken);
        if(!l.exists||l.token!=projectToken||l.curve!=curve||l.pairToken!=quoteToken||
            l.creatorFeeRecipient!=address(this)||l.creatorTaxBps!=300||l.buybackEnabled||
            f.memeHook()!=hook||f.feeEscrow()!=escrow||_poolId(l)!=poolId) revert SourceDrift();
        IPonsCurve c=IPonsCurve(curve);
        if(c.token()!=projectToken||c.pairToken()!=quoteToken||c.factory()!=factory||
            c.deployer()!=address(this)||c.feeEscrow()!=escrow||c.feePolicy()!=hook||
            c.creatorTaxBps()!=300||c.buybackEnabled()) revert SourceDrift();
        if(IPonsHook(hook).factory()!=factory||IPonsHook(hook).feeEscrow()!=escrow) revert SourceDrift();
        phase=l.phase;
        if(phase==2){
            IPonsHook.LaunchInfo memory h=IPonsHook(hook).launches(poolId);
            if(!h.registered||h.memecoin!=projectToken||h.quoteToken!=quoteToken||
                h.creator!=address(this)||h.creatorTaxBps!=300||h.buybackEnabled||
                h.memecoinIsCurrency0!=(projectToken<quoteToken)) revert SourceDrift();
        }
    }
    // These views may fail independently. A venue failure never gates escrow pull/pay.
    function sweepState() public view returns(uint8 phase,bool waiting,uint256 quoteDue) {
        phase=_checkVenue();
        if(phase==0){
            quoteDue=IPonsCurve(curve).quoteFeeBalance()+IPonsCurve(curve).creatorTaxBalance();
        }else if(phase==2){
            IPonsHook h=IPonsHook(hook);
            waiting=h.pendingFees(poolId,projectToken)!=0||h.pendingCreatorTax(poolId,projectToken)!=0||
                h.pendingBuyback(poolId,quoteToken)!=0;
            quoteDue=h.pendingFees(poolId,quoteToken)+h.pendingCreatorTax(poolId,quoteToken);
        }else{waiting=true;}
    }
    function sweepCurve() external nonReentrant {
        (uint8 phase,,)=sweepState(); if(phase!=0) revert WrongPhase();
        IPonsCurve(curve).sweepFees(0); _checkVenue(); emit Swept(phase);
    }
    function sweepPool() external nonReentrant {
        (uint8 phase,bool waiting,)=sweepState();
        if(phase!=2) revert WrongPhase(); if(waiting) revert AwaitingOperator();
        IPonsHook(hook).sweepPoolFees(poolId,0,0); _checkVenue(); emit Swept(phase);
    }
    function bindPromo(Policy calldata initial) external onlyOwner nonReentrant {
        if(promoVault!=address(0)) revert AlreadyBound();
        address promo=initial.recipients[0];
        if(projectToken.code.length==0||promo.code.length==0||
            IPonsPromo(promo).projectToken()!=projectToken||IPonsPromo(promo).quoteToken()!=quoteToken)
            revert InvalidConfiguration();
        promoVault=promo; campaignId=1; _setPolicy(initial);
        emit SourceBound(escrow,escrowCodeHash);
    }
    function _checkBound() private view {
        if(promoVault==address(0)) revert NotBound();
    }
    function _checkSource() private view {
        _checkBound();
        if(escrow.codehash!=escrowCodeHash) revert SourceDrift();
    }
    function _balance() private view returns(uint256 balance) {
        balance=IERC20(quoteToken).balanceOf(address(this));
        if(balance<accounted) revert BalanceDeficit();
    }
    function pull() external nonReentrant returns(uint256 amount) { amount=_pull();_sync(); }
    function _pull() private returns(uint256 amount) {
        _checkSource();uint256 beforeBalance=_balance();
        uint256 due=IPonsEscrow(escrow).balanceOfToken(address(this),quoteToken);
        if(due!=0) IPonsEscrow(escrow).claimToken(quoteToken);
        amount=due;
        uint256 afterBalance=_balance();
        if(afterBalance<beforeBalance||amount!=due||afterBalance-beforeBalance!=due||
            IPonsEscrow(escrow).balanceOfToken(address(this),quoteToken)!=0) revert IncompleteClaim();
        _checkSource();emit Claimed(amount);
    }
    function sync() external nonReentrant { _checkBound();_sync(); }
    function _sync() private {
        uint256 balance=_balance();uint256 amount=balance-accounted;if(amount==0)return;
        uint256 beforeTotal=received[campaignId];uint256 total=beforeTotal+amount;
        received[campaignId]=total;accounted=balance;Policy storage p=policies[campaignId];
        for(uint256 i;i<3;++i)_credit(p.recipients[i],Math.mulDiv(total,p.bps[i],10000)-Math.mulDiv(beforeTotal,p.bps[i],10000));
        emit RevenueRecognized(campaignId,amount);
    }
    /// Existing credits remain payable when the external source has drifted or failed.
    function pay(address recipient) external nonReentrant {
        _balance();uint256 amount=credit[recipient];if(amount==0)return;
        credit[recipient]=0;accounted-=amount;IERC20(quoteToken).safeTransfer(recipient,amount);
        if(recipient==promoVault)IPonsPromo(promoVault).syncUSDG();
        emit Paid(recipient,amount);
    }
    function rollCampaign(uint64 expectedId,Policy calldata next) external onlyOwner nonReentrant {
        _checkBound();
        if(expectedId!=campaignId)revert StaleCampaign();
        if(block.timestamp<policies[campaignId].endsAt)revert CampaignActive();
        // Recognize received USDG only. An unavailable escrow cannot prevent rollover.
        // A delayed claim belongs to the campaign in which its USDG is received.
        _sync();Policy storage p=policies[campaignId];uint256 total=received[campaignId];uint256 allocated;
        for(uint256 i;i<3;++i)allocated+=Math.mulDiv(total,p.bps[i],10000);
        _credit(promoVault,total-allocated);emit CampaignClosed(campaignId,total);
        ++campaignId;_setPolicy(next);
    }
    function _setPolicy(Policy memory p) private {
        if(p.endsAt<=block.timestamp||p.recipients[0]!=promoVault||p.bps[0]!=9000||p.bps[1]!=500||p.bps[2]!=500)
            revert InvalidConfiguration();
        for(uint256 i;i<3;++i)if(p.recipients[i]==address(this)||(p.bps[i]!=0&&p.recipients[i]==address(0)))revert InvalidConfiguration();
        policies[campaignId]=p;emit CampaignOpened(campaignId,p.endsAt,p.recipients,p.bps);
    }
    function _credit(address recipient,uint256 amount) private {
        if(amount==0)return;credit[recipient]+=amount;emit Credited(campaignId,recipient,amount);
    }
}
