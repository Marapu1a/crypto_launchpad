// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "./ChainBlocks.sol";
import {ShortSettlement} from "./ShortSettlement.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ILocalRandom} from "./ILocalRandom.sol";

/// Shared execution core. Network and RNG admission belong to concrete wrappers.
abstract contract ShortControllerBase is ShortSettlement, Ownable2Step {
    struct Setup {
        address vault; address registry; bytes32 instance; address governor; address publisher; address provider;
        uint256 notice; uint256 cutoffDelayBlocks; uint256 maxBudget; uint256 maxGasPrice; uint256 nativeFloor;
    }
    struct Binding { bytes32 drawId; bytes32 context; bool delivered; }
    ILocalRandom public immutable randomProvider;
    uint256 public immutable cutoffDelayBlocks;
    uint256 public immutable maxBudget;
    uint256 public immutable maxGasPrice;
    uint256 public immutable nativeFloor;
    address public publisher;
    address public pendingPublisher;
    mapping(uint256 => Binding) public requests;
    mapping(bytes32 => uint256) public drawRequest;
    bool private requesting;
    event PublisherProposed(address candidate);
    event PublisherAccepted(address publisher);
    event RandomBound(uint256 indexed requestId, bytes32 indexed drawId, bytes32 context);

    constructor(Setup memory s, ShortOutcome.Rules memory r, uint256[] memory w, uint256 minimumUnit)
        ShortSettlement(s.vault,s.registry,s.instance,s.notice,r,w,minimumUnit) Ownable(s.governor) {
        require(s.publisher != address(0) && s.provider.code.length > 0 && s.cutoffDelayBlocks > 0
            && s.cutoffDelayBlocks <= 256 && s.maxBudget > 0 && s.maxGasPrice > 0, "config");
        publisher=s.publisher; randomProvider=ILocalRandom(s.provider); cutoffDelayBlocks=s.cutoffDelayBlocks;
        maxBudget=s.maxBudget; maxGasPrice=s.maxGasPrice; nativeFloor=s.nativeFloor;
    }
    receive() external payable {}
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");_;}
    function proposePublisher(address next) external onlyOwner {
        require(next!=address(0),"publisher");pendingPublisher=next;emit PublisherProposed(next);
    }
    function acceptPublisher() external {
        require(msg.sender==pendingPublisher,"publisher");publisher=msg.sender;pendingPublisher=address(0);emit PublisherAccepted(msg.sender);
    }
    function announce(ShortOutcome.Rules calldata r,uint256[] calldata w,uint256 m) external onlyOwner {_announceShortRules(r,w,m);}
    function activate() external {_activateShortRules();}
    function begin(bytes32 id,Request calldata r) external onlyPublisher {
        require(ChainBlocks.number() >= r.cutoffBlockNumber+cutoffDelayBlocks && r.budget<=maxBudget,"cutoff/budget");
        _checkCutoffHistory(r.cutoffBlockNumber,r.cutoffBlockHash);
        _beginEpochDataset(id,r);
    }
    function publish(bytes32 id,ShortOutcome.Participant[] calldata data) external onlyPublisher {_publishDataset(id,data);}
    function supersede(bytes32 id) external onlyPublisher {_supersedeDataset(id);}
    function closeEmpty(uint256 c,bytes32 h,bytes32 s) external onlyPublisher {
        _checkCutoffHistory(c,h);
        require(ChainBlocks.number()>=c+cutoffDelayBlocks,"cutoff delay");_closeEmptyShortEpoch(c,h,s);
    }
    function _checkCutoffHistory(uint256,bytes32) internal view virtual {}
    function executionReady() public view returns(bool) {
        return !requesting && randomProvider.ready() && tx.gasprice<=maxGasPrice
            && address(this).balance>=randomProvider.fee()+nativeFloor;
    }
    function seal(bytes32 id) external {
        require(executionReady(),"not ready");
        _sealShortDraw(id);Proposal memory p=datasetProposal(id);
        _request(p.request.drawId,p.context);
    }
    function _request(bytes32 drawId,bytes32 context) internal {
        require(!requesting && drawRequest[drawId]==0,"request");requesting=true;
        uint256 key=randomProvider.request{value:randomProvider.fee()}(context);
        require(key!=0 && requests[key].drawId==bytes32(0),"request id");
        requests[key]=Binding(drawId,context,false);drawRequest[drawId]=key;requesting=false;
        emit RandomBound(key,drawId,context);
    }
    function fulfill(uint256 key,bytes32 seed) external {
        require(msg.sender==address(randomProvider) && !requesting,"provider");
        Binding storage b=requests[key];require(b.drawId!=bytes32(0) && !b.delivered,"delivery");
        b.delivered=true;
        _acceptShortSeed(b.drawId,seed);
    }
}
