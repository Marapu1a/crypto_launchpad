// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortDatasetPreparation} from "../../contracts/ShortDatasetPreparation.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
/// @dev Test-only entry points. This is NOT the production authorization policy.
contract ShortDatasetFixture is ShortDatasetPreparation {
    address private immutable publisher = msg.sender;
    constructor(address vault, address registry, bytes32 instance) ShortDatasetPreparation(vault, registry, instance) {}
    modifier onlyPublisher() { require(msg.sender == publisher, "publisher"); _; }
    function begin(bytes32 id, Request calldata r, ShortOutcome.Rules calldata rules,
        uint256[] calldata weights, uint256 minimumUnit) external onlyPublisher {
        _beginDataset(id, r, rules, weights, minimumUnit);
    }
    function publish(bytes32 id, ShortOutcome.Participant[] calldata data) external onlyPublisher { _publishDataset(id, data); }
    function supersede(bytes32 id) external onlyPublisher { _supersedeDataset(id); }
    function seal(bytes32 id) external { _sealDataset(id); }
}

/// @dev Deliberately adversarial external reserve dependency for guard testing only.
contract DatasetReentrantVault {
    function validateDrawId(bytes32, uint8) external pure {}
    address public drawController;
    address public immutable quoteToken = address(0x1234);
    bytes32 public proposal;
    bool public callbackRejected;
    function bind(address controller, bytes32 id) external { drawController = controller; proposal = id; }
    function reserveUSDG(bytes32, uint64, uint8, uint256) external {
        require(msg.sender == drawController, "controller");
        (bool ok, bytes memory data) = drawController.call(abi.encodeWithSignature("seal(bytes32)", proposal));
        require(!ok && data.length == 4, "guard missing");
        require(bytes4(data) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "wrong rejection");
        callbackRejected = true;
    }
}
