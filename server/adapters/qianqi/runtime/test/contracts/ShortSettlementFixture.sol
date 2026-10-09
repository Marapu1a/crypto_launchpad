// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortSettlement} from "../../contracts/ShortSettlement.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
/// TEST ONLY. Publisher chooses seed: never deploy this fixture with real funds.
contract ShortSettlementFixture is ShortSettlement {
    address private immutable publisher = msg.sender;
    constructor(address v,address r,bytes32 i,uint256 notice,ShortOutcome.Rules memory rules,uint256[] memory weights)
        ShortSettlement(v,r,i,notice,rules,weights,1) {}
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");_;}
    function announce(ShortOutcome.Rules calldata r,uint256[] calldata w,uint256 m) external onlyPublisher {_announceShortRules(r,w,m);}
    function activate() external {_activateShortRules();}
    function begin(bytes32 id,Request calldata r) external onlyPublisher {_beginEpochDataset(id,r);}
    function publish(bytes32 id,ShortOutcome.Participant[] calldata data) external onlyPublisher {_publishDataset(id,data);}
    function supersede(bytes32 id) external onlyPublisher {_supersedeDataset(id);}
    function seal(bytes32 id) external {_sealShortDraw(id);}
    function closeEmpty(uint256 c,bytes32 h,bytes32 s) external onlyPublisher {_closeEmptyShortEpoch(c,h,s);}
    function supplySeed(bytes32 drawId,bytes32 seed) external onlyPublisher {_acceptShortSeed(drawId,seed);}
}

/// Adversarial dependency only: real PromoVault does not call back on finalize.
contract SettlementReentrantVault {
    function validateDrawId(bytes32, uint8) external pure {}
    address public drawController;
    address public constant quoteToken = address(0x1234);
    bool public callbackRejected;
    struct Draw { address asset; uint64 campaign; uint8 status; uint256 budget; uint256 awarded; uint256 paid; }
    mapping(bytes32 => Draw) public draws;
    function bind(address source) external { drawController = source; }
    function reserveUSDG(bytes32 id, uint64 campaign, uint8, uint256 budget) external {
        require(msg.sender == drawController, "controller");
        draws[id] = Draw(quoteToken, campaign, 1, budget, 0, 0);
    }
    function finalize(bytes32 id, address[] calldata, uint256[] calldata amounts) external {
        require(msg.sender == drawController, "controller");
        (bool ok, bytes memory data) = drawController.call(abi.encodeWithSignature("finishShort(bytes32)", id));
        require(!ok && data.length == 4 && bytes4(data) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "guard missing");
        callbackRejected = true; draws[id].status = 2;
        for(uint256 i; i < amounts.length; ++i) draws[id].awarded += amounts[i];
    }
}
