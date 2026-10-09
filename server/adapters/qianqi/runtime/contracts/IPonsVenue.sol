// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IPonsFactory {
    struct Launch {
        address token; address curve; address deployer; address creatorFeeRecipient;
        address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing;
        uint16 creatorTaxBps; bool buybackEnabled; uint8 phase;
        uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists;
    }
    function getLaunchedToken(address token) external view returns(Launch memory);
    function memeHook() external view returns(address);
    function feeEscrow() external view returns(address);
}
interface IPonsCurve {
    function token() external view returns(address);
    function pairToken() external view returns(address);
    function factory() external view returns(address);
    function deployer() external view returns(address);
    function feeEscrow() external view returns(address);
    function feePolicy() external view returns(address);
    function buybackEnabled() external view returns(bool);
    function creatorTaxBps() external view returns(uint256);
    function quoteFeeBalance() external view returns(uint256);
    function creatorTaxBalance() external view returns(uint256);
    function sweepFees(uint256) external;
}
interface IPonsHook {
    struct LaunchInfo {
        bool registered; bool memecoinIsCurrency0; address memecoin; address quoteToken;
        address creator; address buybackCreatorRecipient; address protocolFeeRecipient;
        uint16 creatorTaxBps; uint16 protocolFeeShareBps; uint16 buybackBurnBps;
        uint16 hookFeeBps; uint16 maxInternalPriceImpactBps; bool buybackEnabled;
    }
    function launches(bytes32) external view returns(LaunchInfo memory);
    function factory() external view returns(address);
    function feeEscrow() external view returns(address);
    function pendingFees(bytes32,address) external view returns(uint256);
    function pendingCreatorTax(bytes32,address) external view returns(uint256);
    function pendingBuyback(bytes32,address) external view returns(uint256);
    function sweepPoolFees(bytes32,uint256,uint256) external;
}
