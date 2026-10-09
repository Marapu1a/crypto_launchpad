// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IInfinityCreatorVault {
    function projectToken() external view returns(address);
    function hook() external view returns(address);
    function admin() external view returns(address);
    function epochCount() external view returns(uint256);
    function currentPolicy() external view returns(uint64,address,uint16);
    function claimable(address,address) external view returns(uint256);
    function claim(address[] calldata) external returns(uint256);
}
interface IInfinityHook {
    struct Policy { uint8 mode; uint16 feeBps; address destination; uint64 effectiveAt; }
    function activePolicy(address) external view returns(Policy memory);
    function tokenStates(address) external view returns(uint64,bool,bool);
    function policies(address,uint64) external view returns(uint8,uint16,address,uint64);
}
interface IInfinityFactory {
    function verifyVault(address,uint8,address) external view returns(bool);
}
interface IInfinityPromo {
    function projectToken() external view returns(address);
    function quoteToken() external view returns(address);
    function syncUSDG() external;
}

/// @notice USDG-only creator revenue accounting. Source bindings require independent
/// deployment admission. A successful rollover is the accounting boundary, not endsAt.
contract InfinityCollector is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Policy { uint64 endsAt; address[3] recipients; uint16[3] bps; }
    address public immutable projectToken;
    address public immutable quoteToken;
    address public immutable hook;
    address public immutable factory;
    address public promoVault;
    IInfinityCreatorVault public source;
    bytes32 public sourceFingerprint;
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
    event SourceBound(address indexed vault, bytes32 fingerprint);
    event CampaignOpened(uint64 indexed id, uint64 endsAt, address[3] recipients, uint16[3] bps);
    event CampaignClosed(uint64 indexed id, uint256 revenue);
    event RevenueRecognized(uint64 indexed id, uint256 amount);
    event Credited(uint64 indexed id, address indexed recipient, uint256 amount);
    event Claimed(uint256 amount);
    event Paid(address indexed recipient, uint256 amount);

    constructor(address owner_, address token, address quote, address hook_, address factory_) Ownable(owner_) {
        // TOKEN may not exist yet: its address is predicted before the PAIR launch.
        if(token==address(0)||token==quote||quote.code.length==0||hook_.code.length==0||factory_.code.length==0)
            revert InvalidConfiguration();
        projectToken=token; quoteToken=quote; hook=hook_; factory=factory_;
    }
    function policy(uint64 id) external view returns(Policy memory) { return policies[id]; }
    function bindSource(address vault, Policy calldata initial) external onlyOwner nonReentrant {
        if(address(source)!=address(0)) revert AlreadyBound();
        if(vault.code.length==0||projectToken.code.length==0) revert InvalidConfiguration();
        source=IInfinityCreatorVault(vault);
        if(source.projectToken()!=projectToken||source.hook()!=hook||source.admin()!=factory||
            !IInfinityFactory(factory).verifyVault(projectToken,1,vault)) revert InvalidConfiguration();
        IInfinityHook.Policy memory hp=IInfinityHook(hook).activePolicy(projectToken);
        (uint64 epoch,address recipient,uint16 fee)=source.currentPolicy();
        (uint64 latest,,)=IInfinityHook(hook).tokenStates(projectToken);
        if(hp.mode!=1||hp.feeBps!=300||hp.destination!=vault||hp.effectiveAt>block.timestamp||
            epoch==0||latest==0||recipient!=address(this)||fee!=300||source.epochCount()!=epoch)
            revert InvalidConfiguration();
        // Reject pending hook policies as well: latest must be the active policy.
        // The hook exposes active values, not its active epoch; check latest entry explicitly.
        (uint8 mode,uint16 rate,address destination,uint64 at)=IInfinityHook(hook).policies(projectToken,latest);
        if(keccak256(abi.encode(mode,rate,destination,at))!=keccak256(abi.encode(hp.mode,hp.feeBps,hp.destination,hp.effectiveAt)))
            revert InvalidConfiguration();
        promoVault=initial.recipients[0];
        if(promoVault.code.length==0||IInfinityPromo(promoVault).projectToken()!=projectToken||
            IInfinityPromo(promoVault).quoteToken()!=quoteToken) revert InvalidConfiguration();
        sourceFingerprint=_fingerprint();campaignId=1;_setPolicy(initial);
        emit SourceBound(vault,sourceFingerprint);
    }
    function _fingerprint() private view returns(bytes32) {
        (uint64 latest,,)=IInfinityHook(hook).tokenStates(projectToken);
        (uint64 epoch,address recipient,uint16 fee)=source.currentPolicy();
        return keccak256(abi.encode(latest,IInfinityHook(hook).activePolicy(projectToken),source.epochCount(),
            epoch,recipient,fee,source.projectToken(),source.hook(),source.admin(),
            IInfinityFactory(factory).verifyVault(projectToken,1,address(source))));
    }
    function _checkSource() private view {
        if(address(source)==address(0)) revert NotBound();
        if(_fingerprint()!=sourceFingerprint) revert SourceDrift();
    }
    function _balance() private view returns(uint256 balance) {
        balance=IERC20(quoteToken).balanceOf(address(this));
        if(balance<accounted) revert BalanceDeficit();
    }
    function pull() external nonReentrant returns(uint256 amount) { amount=_pull();_sync(); }
    function _pull() private returns(uint256 amount) {
        _checkSource();uint256 beforeBalance=_balance();
        uint256 due=source.claimable(address(this),quoteToken);
        if(due!=0){address[] memory assets=new address[](1);assets[0]=quoteToken;amount=source.claim(assets);}
        uint256 afterBalance=_balance();
        if(afterBalance<beforeBalance||amount!=due||afterBalance-beforeBalance!=due||
            source.claimable(address(this),quoteToken)!=0) revert IncompleteClaim();
        _checkSource();emit Claimed(amount);
    }
    function sync() external nonReentrant { _checkSource();_sync(); }
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
        if(recipient==promoVault)IInfinityPromo(promoVault).syncUSDG();
        emit Paid(recipient,amount);
    }
    function rollCampaign(uint64 expectedId,Policy calldata next) external onlyOwner nonReentrant {
        if(address(source)==address(0))revert NotBound();
        if(expectedId!=campaignId)revert StaleCampaign();
        if(block.timestamp<policies[campaignId].endsAt)revert CampaignActive();
        _pull();_sync();Policy storage p=policies[campaignId];uint256 total=received[campaignId];uint256 allocated;
        for(uint256 i;i<3;++i)allocated+=Math.mulDiv(total,p.bps[i],10000);
        _credit(promoVault,total-allocated);emit CampaignClosed(campaignId,total);
        ++campaignId;_setPolicy(next);
    }
    function _setPolicy(Policy memory p) private {
        if(p.endsAt<=block.timestamp||p.recipients[0]!=promoVault||uint256(p.bps[0])+p.bps[1]+p.bps[2]!=10000)
            revert InvalidConfiguration();
        for(uint256 i;i<3;++i)if(p.recipients[i]==address(this)||(p.bps[i]!=0&&p.recipients[i]==address(0)))revert InvalidConfiguration();
        policies[campaignId]=p;emit CampaignOpened(campaignId,p.endsAt,p.recipients,p.bps);
    }
    function _credit(address recipient,uint256 amount) private {
        if(amount==0)return;credit[recipient]+=amount;emit Credited(campaignId,recipient,amount);
    }
}
