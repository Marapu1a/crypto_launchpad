// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ParticipantRegistry} from "../../contracts/ParticipantRegistry.sol";

/// TEST ONLY: markers model event ordering, not authenticated eligible DEX purchases.
contract RegistrationWalletFixture {
    event PurchaseMarker(uint256 sequence);

    function registerBetweenMarkers(ParticipantRegistry registry) external {
        emit PurchaseMarker(1);
        registry.register();
        emit PurchaseMarker(2);
    }
}
