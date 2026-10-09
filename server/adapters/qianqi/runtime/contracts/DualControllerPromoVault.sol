// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PromoVault} from "./PromoVault.sol";

interface IShortVaultBinding { function datasetVault() external view returns(address); }
interface IMonthlyVaultBinding { function monthlyVault() external view returns(address); }

/// USDG-only prize operations with two fixed, disjoint controller capabilities.
/// Deploy both controllers bound to the predicted vault address BEFORE this vault.
/// Reverse binding is an identity check, not a proof of controller correctness.
contract DualControllerPromoVault is PromoVault {
    address public immutable shortController;
    address public immutable monthlyController;
    error ForbiddenReserve();
    error OnlyMonthlyController();
    error InvalidDrawNamespace();

    /// One canonical ID everywhere: high bit 0 = Short, 1 = Monthly.
    /// Nonzero low 255 bits identify the draw within its kind.
    function validateDrawId(bytes32 drawId, uint8 kind) public pure override {
        uint256 value = uint256(drawId);
        if (kind > 1 || value >> 255 != kind || (value & (type(uint256).max >> 1)) == 0)
            revert InvalidDrawNamespace();
    }

    constructor(address token,address quote,address shortSource,address monthlySource,uint256 target)
        PromoVault(token,quote,shortSource,target) {
        if(monthlySource.code.length==0 || monthlySource==shortSource
            || IShortVaultBinding(shortSource).datasetVault()!=address(this)
            || IMonthlyVaultBinding(monthlySource).monthlyVault()!=address(this)) revert InvalidConfiguration();
        shortController=shortSource;monthlyController=monthlySource;
    }
    // Legacy drawController getter aliases SHORT only, never an all-powerful root.
    function _authorizeMonthly() internal view override {
        if(msg.sender!=monthlyController) revert OnlyMonthlyController();
    }
    function _validateTokenReserve() internal pure override { revert ForbiddenReserve(); }
    function _validateUSDGSource(ReserveSource source) internal pure override {
        if(source!=ReserveSource.SHORT) revert ForbiddenReserve();
    }
}
