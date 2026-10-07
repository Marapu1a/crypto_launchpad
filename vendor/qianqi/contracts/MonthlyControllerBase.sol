// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "./ChainBlocks.sol";
import {MonthlySettlement} from "./MonthlySettlement.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ILocalRandom} from "./ILocalRandom.sol";

/// Shared execution core. Network and RNG admission belong to concrete wrappers.
abstract contract MonthlyControllerBase is MonthlySettlement, Ownable2Step {
    struct Setup { address vault; address registry; bytes32 instance; address governor; address publisher; address provider;
        uint256 interval; uint256 notice; uint256 cutoffDelayBlocks; uint256 maxGasPrice; uint256 nativeFloor; }
    struct Binding { bytes32 drawId; bytes32 context; bool delivered; }
    ILocalRandom public immutable randomProvider;
    uint256 public immutable cutoffDelayBlocks;
    uint256 public immutable maxGasPrice;
    uint256 public immutable nativeFloor;
    address public publisher;
    address public pendingPublisher;
    bool private requesting;
    mapping(uint256=>Binding) public requests;
    mapping(bytes32=>uint256) public drawRequest;
    event PublisherProposed(address candidate);
    event PublisherAccepted(address publisher);
    event RandomBound(uint256 indexed requestId,bytes32 indexed drawId,bytes32 context);
    constructor(Setup memory s,ShortOutcome.Rules memory r)
        MonthlySettlement(s.vault,s.registry,s.instance,s.interval,s.notice,r) Ownable(s.governor){
        require(s.publisher!=address(0)&&s.provider.code.length>0&&s.cutoffDelayBlocks>0&&s.cutoffDelayBlocks<=256&&s.maxGasPrice>0,"config");
        publisher=s.publisher;randomProvider=ILocalRandom(s.provider);cutoffDelayBlocks=s.cutoffDelayBlocks;
        maxGasPrice=s.maxGasPrice;nativeFloor=s.nativeFloor;
    }
    receive() external payable {}
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");_;}
    function proposePublisher(address next) external onlyOwner {
        require(next!=address(0),"publisher");pendingPublisher=next;emit PublisherProposed(next);
    }
    function acceptPublisher() external {
        require(msg.sender==pendingPublisher,"publisher");publisher=msg.sender;pendingPublisher=address(0);emit PublisherAccepted(msg.sender);
    }
    function beginMonth(Input calldata input) external onlyPublisher {
        require(ChainBlocks.number()>=input.cutoff+cutoffDelayBlocks,"cutoff delay");_checkCutoffHistory(input.cutoff,input.cutoffHash);_beginMonth(input);
    }
    function announce(ShortOutcome.Rules calldata rules) external onlyOwner {_announceMonthlyRules(rules);}
    function activate() external {_activateMonthlyRules();}
    function closeEmpty(uint256 c,bytes32 h,bytes32 s) external onlyPublisher {
        _checkCutoffHistory(c,h);
        require(ChainBlocks.number()>=c+cutoffDelayBlocks,"cutoff delay");_closeEmptyMonthlyEpoch(c,h,s);
    }
    function publishMonth(bytes32 id,ShortOutcome.Participant[] calldata chunk) external onlyPublisher {_publishMonth(id,chunk);}
    function supersedeMonth(bytes32 id) external onlyPublisher {_supersedeMonth(id);}
    function _checkCutoffHistory(uint256,bytes32) internal view virtual {}
    function executionReady() public view returns(bool){
        return !requesting&&randomProvider.ready()&&tx.gasprice<=maxGasPrice&&address(this).balance>=randomProvider.fee()+nativeFloor;
    }
    function sealMonth(bytes32 id) external {
        require(executionReady()&&drawRequest[id]==0,"not ready");_sealMonth(id);
        bytes32 context=month(id).context;requesting=true;
        uint256 key=randomProvider.request{value:randomProvider.fee()}(context);
        require(key!=0&&requests[key].drawId==bytes32(0),"request id");
        requests[key]=Binding(id,context,false);drawRequest[id]=key;requesting=false;emit RandomBound(key,id,context);
    }
    function fulfill(uint256 key,bytes32 seed) external {
        require(msg.sender==address(randomProvider)&&!requesting,"provider");
        Binding storage b=requests[key];require(b.drawId!=bytes32(0)&&!b.delivered,"delivery");
        b.delivered=true;_acceptMonthlySeed(b.drawId,seed);
    }
}
