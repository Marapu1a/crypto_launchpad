// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {FeeCollector} from "./FeeCollector.sol";

interface IPonsFactory {
    struct Launch {
        address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
        uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps;
        bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists;
    }
    function getLaunchedToken(address token) external view returns (Launch memory);
}
interface IPonsCurve {
    function token() external view returns(address);
    function factory() external view returns(address);
    function pairToken() external view returns(address);
    function deployer() external view returns(address);
    function feeEscrow() external view returns(address);
    function sweepFees(uint256 minimum) external;
}

/// Chain-4663 curve adapter. One immutable factory and one irreversible token binding.
contract PonsFeeCollector is FeeCollector {
    IPonsFactory public immutable factory;
    address public immutable binder;
    address public token;
    address public curve;
    event Bound(address indexed token, address indexed curve);

    constructor(address asset, address escrow_, address destination_, address factory_)
        FeeCollector(asset, escrow_, destination_) {
        require(factory_.code.length > 0, "factory");
        factory = IPonsFactory(factory_);
        binder = msg.sender;
    }

    function bind(address token_) external nonReentrant {
        require(msg.sender == binder && token == address(0), "binding authority/state");
        IPonsFactory.Launch memory launch = factory.getLaunchedToken(token_);
        require(launch.exists && launch.token == token_ && launch.creatorFeeRecipient == address(this)
            && launch.pairToken == address(quote) && !launch.buybackEnabled, "launch binding");
        IPonsCurve venue = IPonsCurve(launch.curve);
        require(venue.token() == token_ && venue.factory() == address(factory)
            && venue.pairToken() == address(quote) && venue.deployer() == address(this)
            && venue.feeEscrow() == escrow, "curve binding");
        token = token_; curve = launch.curve;
        emit Bound(token_, launch.curve);
    }

    // Anyone can trigger distribution; neither venue nor destination is caller supplied.
    // Pool graduation and swaps requiring the Pons operator remain separate paths.
    function sweepCurve() external nonReentrant {
        require(curve != address(0), "unbound");
        IPonsCurve(curve).sweepFees(0);
    }
}
