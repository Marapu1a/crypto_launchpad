// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {NativeHolderVault} from "./NativeHolderVault.sol";

/// Local payout prototype. Publisher is trusted to calculate fair allocations.
/// This contract checks conservation/commitments, not Pons snapshot correctness.
contract ManagedNativeHolderPayoutVault is NativeHolderVault, ReentrancyGuard, Ownable2Step {
    address public publisher;
    address public immutable initialOwner;
    address public immutable initialPublisher;
    bool public publicationsPaused;
    event PublicationsPaused(bool paused);
    event PublisherChanged(address indexed previousPublisher,address indexed newPublisher);
    uint256 public immutable minimumPayment;
    uint256 public totalAllocated;
    uint256 public totalPaid;
    uint256 public pendingBudget;
    uint256 public lastPeriod;
    uint256 public constant MAX_CHUNK=100;
    uint256 public constant MAX_CLAIM_ROUNDS=100;
    struct Round {
        bytes32 commitment;
        bytes32 rolling;
        uint256 budget;
        uint256 count;
        uint256 written;
        uint256 allocated;
        address lastWallet;
        bool complete;
    }
    mapping(uint256=>Round) public rounds;
    mapping(uint256=>mapping(address=>uint256)) public entitlement;
    mapping(uint256=>mapping(address=>bool)) public consolidated;
    mapping(address=>uint256) public credit;
    event RoundOpened(uint256 indexed period,bytes32 snapshot,bytes32 commitment,uint256 budget,uint256 count);
    event Allocation(uint256 indexed period,address indexed wallet,uint256 amount);
    event RoundSealed(uint256 indexed period,uint256 allocated,uint256 remainder);
    event Paid(address indexed wallet,uint256 amount,uint256 totalPaid);
    event Consolidated(address indexed wallet,uint256 amount);
    constructor(bytes32 instance_,address owner_,address publisher_,uint256 minimumPayment_) NativeHolderVault(instance_) Ownable(owner_) {
        require(publisher_!=address(0)&&publisher_!=owner_&&publisher_!=address(this)&&minimumPayment_>0,"policy");
        initialOwner=owner_;initialPublisher=publisher_;
        publisher=publisher_;minimumPayment=minimumPayment_;
    }
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");require(!publicationsPaused,"publications paused");_;}
    function setPublicationsPaused(bool paused) external onlyOwner {
        publicationsPaused=paused;emit PublicationsPaused(paused);
    }
    function setPublisher(address next) external onlyOwner {
        require(publicationsPaused,"pause first");
        require(next!=address(0)&&next!=address(this)&&next!=owner()&&next!=pendingOwner(),"publisher role");
        emit PublisherChanged(publisher,next);publisher=next;
    }
    function transferOwnership(address next) public override onlyOwner {
        require(next!=publisher&&next!=address(this),"owner role");
        super.transferOwnership(next);
    }
    function renounceOwnership() public override onlyOwner {revert("owner required");}
    function available() public view returns(uint256){return totalReceived-totalAllocated-pendingBudget;}
    function solvent() public view returns(bool){return address(this).balance>=totalReceived-totalPaid;}
    function openRound(uint256 period,bytes32 snapshot,bytes32 commitment,uint256 budget,uint256 count) external onlyPublisher {
        require(period==lastPeriod+1&&rounds[period].commitment==bytes32(0),"period");
        require(snapshot!=bytes32(0)&&commitment!=bytes32(0)&&count<=5000,"commitment/count");
        require(budget>0&&budget<=available()&&solvent(),"budget/solvency");
        bytes32 seed=keccak256(abi.encode(block.chainid,address(this),instance,period,snapshot,budget,count));
        rounds[period]=Round(commitment,seed,budget,count,0,0,address(0),false);
        pendingBudget=budget;emit RoundOpened(period,snapshot,commitment,budget,count);
    }
    function append(uint256 period,uint256 offset,address[] calldata wallets,uint256[] calldata amounts) external onlyPublisher {
        Round storage r=rounds[period];
        require(r.commitment!=bytes32(0)&&!r.complete&&offset==r.written,"round/offset");
        require(wallets.length>0&&wallets.length<=MAX_CHUNK&&wallets.length==amounts.length&&r.written+wallets.length<=r.count,"length");
        for(uint256 i;i<wallets.length;i++){
            require(wallets[i]>r.lastWallet&&wallets[i]!=address(this)&&amounts[i]>0,"allocation");
            r.allocated+=amounts[i];require(r.allocated<=r.budget,"budget");
            r.rolling=keccak256(abi.encode(r.rolling,wallets[i],amounts[i]));
            r.lastWallet=wallets[i];entitlement[period][wallets[i]]=amounts[i];
            emit Allocation(period,wallets[i],amounts[i]);
        }
        r.written+=wallets.length;
    }
    function seal(uint256 period) external onlyPublisher {
        Round storage r=rounds[period];
        require(period==lastPeriod+1&&r.commitment!=bytes32(0)&&!r.complete&&r.written==r.count&&r.rolling==r.commitment,"incomplete");
        r.complete=true;totalAllocated+=r.allocated;pendingBudget=0;lastPeriod=period;
        emit RoundSealed(period,r.allocated,r.budget-r.allocated);
    }
    // Consolidate arbitrarily many historical periods through bounded calls.
    // This changes only representation of debt, never its owner or total.
    function consolidate(address wallet,uint256[] calldata periods) public {
        require(periods.length<=MAX_CLAIM_ROUNDS,"length");
        uint256 amount;uint256 previous;
        for(uint256 i;i<periods.length;i++){
            uint256 period=periods[i];require(period>previous&&rounds[period].complete,"period");previous=period;
            if(!consolidated[period][wallet]){amount+=entitlement[period][wallet];consolidated[period][wallet]=true;}
        }
        credit[wallet]+=amount;emit Consolidated(wallet,amount);
    }
    // Anyone may sponsor gas. ETH always goes to the original beneficiary.
    function pay(address payable wallet,uint256[] calldata periods) external nonReentrant {
        require(solvent(),"solvency");consolidate(wallet,periods);
        uint256 amount=credit[wallet];require(amount>=minimumPayment,"minimum");
        credit[wallet]=0;totalPaid+=amount;
        (bool ok,)=wallet.call{value:amount}("");require(ok,"recipient");
        emit Paid(wallet,amount,totalPaid);
    }
}
