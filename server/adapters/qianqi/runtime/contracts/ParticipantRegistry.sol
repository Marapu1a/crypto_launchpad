// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Public opt-in for one promo instance. Registration does not grant entries.
/// Indexers must replay canonical Registered logs in block/transaction/log order;
/// the current mapping alone cannot establish eligibility for historical purchases.
contract ParticipantRegistry {
    mapping(address => bool) public registered;

    error AlreadyRegistered();
    event Registered(address indexed participant);

    /// Smart-contract wallets are allowed. No third-party enrolment or backdating.
    function register() external {
        if (registered[msg.sender]) revert AlreadyRegistered();
        registered[msg.sender] = true;
        emit Registered(msg.sender);
    }
}
