// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Deterministic outcome arithmetic. Does not authenticate seed or participants.
library ShortOutcome {
    error InvalidOutcomeInput();
    struct Participant { address wallet; uint128 firstAttempt; uint128 lastAttempt; }
    // Version identifies this exact algorithm/encoding. Parameters are per draw.
    struct Rules { uint32 version; uint32 pNumerator; uint32 pDenominator; uint32 hNumerator; uint32 hDenominator; }
    struct Result {
        address[] winners;
        uint256[] amounts;
        uint256[] prizeIndices;
        uint256 admittedCount;
        bytes32 resultHash;
    }
    struct Candidate { address wallet; uint256 rank; }
    bytes32 private constant ADMISSION = keccak256("SHORT_ADMISSION_V1");
    bytes32 private constant ORDER = keccak256("SHORT_ORDER_V1");
    bytes32 private constant PRIZE = keccak256("SHORT_PRIZE_ORDER_V1");

    function rulesHash(Rules memory r) internal pure returns (bytes32) {
        _validateRules(r);
        return keccak256(abi.encode(keccak256("SHORT_OUTCOME_RULES_V1"), r));
    }

    function _validateRules(Rules memory r) private pure {
        if (r.version != 1 || r.pNumerator == 0 || r.pNumerator >= r.pDenominator
            || r.hNumerator == 0 || r.hDenominator == 0
            || _gcd(r.pNumerator, r.pDenominator) != 1 || _gcd(r.hNumerator, r.hDenominator) != 1)
            revert InvalidOutcomeInput();
    }

    function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) { uint256 next = a % b; a = b; b = next; }
        return a;
    }

    function participantsHash(Participant[] memory participants) internal pure returns (bytes32) {
        _validateParticipants(participants);
        return keccak256(abi.encode(participants));
    }

    function _validateParticipants(Participant[] memory participants) private pure {
        address previous;
        for (uint256 i; i < participants.length; ++i) {
            Participant memory p = participants[i];
            if (p.wallet <= previous || p.firstAttempt == 0 || p.lastAttempt < p.firstAttempt)
                revert InvalidOutcomeInput();
            previous = p.wallet;
        }
    }

    /// floor(2^256 * p * e/(e+h)); downward error < 2^-256.
    /// Caller validates rules. Widths ensure numerator/denominator and their sum fit uint256.
    function threshold(uint128 entries, Rules memory r) internal pure returns (uint256) {
        uint256 scaledEntries = uint256(entries) * r.hDenominator;
        uint256 numerator = uint256(r.pNumerator) * scaledEntries;
        uint256 denominator = uint256(r.pDenominator) * (scaledEntries + r.hNumerator);
        uint256 result = Math.mulDiv(type(uint256).max, numerator, denominator);
        if (mulmod(type(uint256).max, numerator, denominator) + numerator >= denominator) ++result;
        return result;
    }

    function compute(bytes32 context, bytes32 seed, Participant[] memory participants,
        Rules memory rules, uint256[] memory prizes) internal pure returns (Result memory result)
    {
        if (context == bytes32(0) || prizes.length == 0 || prizes.length > 64) revert InvalidOutcomeInput();
        uint256 total;
        for (uint256 i; i < prizes.length; ++i) {
            if (prizes[i] == 0) revert InvalidOutcomeInput();
            total += prizes[i]; // Reject overflowing baskets, even outside custody integration.
        }
        Candidate[] memory selected;
        (selected, result.admittedCount) = selectTopK(context, seed, participants, rules, prizes.length);
        uint256 count = Math.min(result.admittedCount, prizes.length);
        uint256[] memory slots = _slots(context, seed, prizes.length);
        result.winners = new address[](count);
        result.amounts = new uint256[](count);
        result.prizeIndices = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            result.winners[i] = selected[i].wallet;
            result.prizeIndices[i] = slots[i];
            result.amounts[i] = prizes[slots[i]];
        }
        // The pre-hash Result has resultHash == 0 by construction; explicit schema.
        // selectTopK has validated these exact rules and participants already.
        bytes32 rh = keccak256(abi.encode(keccak256("SHORT_OUTCOME_RULES_V1"), rules));
        bytes32 ph = keccak256(abi.encode(participants));
        result.resultHash = keccak256(abi.encode(keccak256("SHORT_RESULT_V1"), context, seed,
            ph, rh, keccak256(abi.encode(prizes)), result));
    }

    /// Validated selection shared by atomic and streaming paths. Only the first
    /// min(admitted, k) elements are populated; the remaining allocated slots are zero.
    /// Does not assign prizes or compute a result hash. Candidate ranks are reusable.
    function selectTopK(bytes32 context, bytes32 seed, Participant[] memory participants,
        Rules memory rules, uint256 k) internal pure returns (Candidate[] memory best, uint256 admitted)
    {
        if (context == bytes32(0) || k == 0 || k > 64) revert InvalidOutcomeInput();
        _validateRules(rules);
        _validateParticipants(participants);
        best = new Candidate[](k);
        for (uint256 i; i < participants.length; ++i) {
            Participant memory p = participants[i];
            uint256 random = uint256(keccak256(abi.encode(ADMISSION, context, seed, p.wallet)));
            if (random >= threshold(p.lastAttempt - p.firstAttempt + 1, rules)) continue;
            Candidate memory candidate = Candidate(p.wallet, uint256(keccak256(abi.encode(ORDER, context, seed, p.wallet))));
            uint256 position = Math.min(admitted, k);
            ++admitted;
            while (position > 0 && _before(candidate, best[position - 1])) {
                if (position < k) best[position] = best[position - 1];
                --position;
            }
            if (position < k) best[position] = candidate;
        }
    }

    function _before(Candidate memory a, Candidate memory b) private pure returns (bool) {
        return a.rank < b.rank || (a.rank == b.rank && a.wallet < b.wallet);
    }

    // Uniform hash ranking up to negligible 256-bit collision/tie bias. No modulo.
    function _slots(bytes32 context, bytes32 seed, uint256 k) private pure returns (uint256[] memory indices) {
        indices = new uint256[](k);
        uint256[] memory ranks = new uint256[](k);
        for (uint256 i; i < k; ++i) {
            uint256 rank = uint256(keccak256(abi.encode(PRIZE, context, seed, i)));
            uint256 position = i;
            while (position > 0 && rank < ranks[position - 1]) {
                ranks[position] = ranks[position - 1];
                indices[position] = indices[position - 1];
                --position;
            }
            ranks[position] = rank;
            indices[position] = i; // Equal ranks retain the smaller original index first.
        }
    }
}
