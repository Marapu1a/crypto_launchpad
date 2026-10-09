// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortDrawCommitment} from "../../contracts/ShortDrawCommitment.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";

/// @dev UNRESTRICTED seed/rules injection for local verification/gas ONLY.
/// Not a production controller, RNG integration, scheduler or version activator.
contract ShortOutcomeFixture is ShortDrawCommitment {
    mapping(bytes32 => ShortOutcome.Rules) private outcomeRules;
    event AttemptsConsumed(bytes32 indexed drawId, uint8 indexed kind, bytes32 snapshotHash, uint8 outcome, bytes32 resultHash);
    event Measured(uint256 verificationGas, uint256 finalizeGas);
    constructor(address vault, address registry, bytes32 instance) ShortDrawCommitment(vault, registry, instance) {}

    function freeze(FreezeRequest calldata request, BasketRules calldata basket, ShortOutcome.Rules calldata rules) external {
        require(basket.remainingRulesHash == ShortOutcome.rulesHash(rules), "outcome rules mismatch");
        _freezeShort(request, basket);
        outcomeRules[request.drawId] = rules;
    }
    function calculate(bytes32 context, bytes32 seed, ShortOutcome.Participant[] calldata participants,
        ShortOutcome.Rules calldata rules, uint256[] calldata prizes) external pure returns (ShortOutcome.Result memory)
    { return ShortOutcome.compute(context, seed, participants, rules, prizes); }
    function selectCandidates(bytes32 context, bytes32 seed, ShortOutcome.Participant[] calldata participants,
        ShortOutcome.Rules calldata rules, uint256 k) external pure returns (ShortOutcome.Candidate[] memory, uint256)
    { return ShortOutcome.selectTopK(context, seed, participants, rules, k); }
    function probabilityThreshold(uint128 entries, ShortOutcome.Rules calldata rules) external pure returns (uint256) {
        ShortOutcome.rulesHash(rules);
        return ShortOutcome.threshold(entries, rules);
    }
    function participantHash(ShortOutcome.Participant[] calldata participants) external pure returns (bytes32) {
        return ShortOutcome.participantsHash(participants);
    }
    function settle(bytes32 drawId, bytes32 seed, ShortOutcome.Participant[] calldata participants) external nonReentrant {
        uint256 start = gasleft();
        require(pendingShortDrawId == drawId && drawId != bytes32(0), "not pending");
        Commitment memory commitment = this.shortCommitment(drawId);
        require(ShortOutcome.participantsHash(participants) == commitment.request.evmParticipantsHash, "participants mismatch");
        (uint256[] memory prizes,,) = this.shortBasket(drawId);
        ShortOutcome.Result memory result = ShortOutcome.compute(shortCommitmentHash[drawId], seed, participants, outcomeRules[drawId], prizes);
        uint256 verificationGas = start - gasleft();
        start = gasleft();
        promoVault.finalize(drawId, result.winners, result.amounts);
        uint256 finalizeGas = start - gasleft();
        pendingShortDrawId = bytes32(0);
        emit AttemptsConsumed(drawId, 0, commitment.request.attemptSnapshotHash,
            result.winners.length == 0 ? 0 : 1, result.resultHash);
        emit Measured(verificationGas, finalizeGas);
    }
}
