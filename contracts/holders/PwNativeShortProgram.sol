// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {NativeShortProgram} from "../production/native/NativeShortProgram.sol";
import {ShortDrandAdapter} from "../production/ShortDrandAdapter.sol";
import {IPonsFactory} from "../production/PonsFeeCollector.sol";
interface IPwLaunchClock {function launchedAt() external view returns(uint256);}

/// Same draw mechanics; first period starts at the actual Pons launch.
contract PwNativeShortProgram is NativeShortProgram {
    address public immutable binder;
    address public immutable expectedToken;
    address public immutable expectedCollector;
    IPonsFactory public immutable factory;
    bool public launchBound;
    uint256 public launchAt;
    event LaunchBound(address indexed token,uint256 launchedAt);
    constructor(Setup memory setup,uint256[] memory weights_,ShortDrandAdapter.Timing memory timing,
        address factory_,address token_,address collector_) NativeShortProgram(setup,weights_,timing) {
        require(factory_.code.length>0&&token_!=address(0)&&collector_!=address(0),"launch policy");
        binder=msg.sender;factory=IPonsFactory(factory_);expectedToken=token_;expectedCollector=collector_;
        // Sum with interval cannot overflow; no timestamp can reach readiness before binding.
        lastTerminal=type(uint256).max-interval;
    }
    function bindLaunch() external {
        require(msg.sender==binder&&!launchBound&&cycle==0,"launch binding");
        IPonsFactory.Launch memory launch=factory.getLaunchedToken(expectedToken);
        require(launch.exists&&launch.token==expectedToken&&launch.creatorFeeRecipient==expectedCollector
            &&launch.pairToken==address(0)&&!launch.buybackEnabled,"launch policy");
        uint256 started=IPwLaunchClock(launch.curve).launchedAt();
        require(started>0&&started<=block.timestamp,"launch time");
        launchBound=true;launchAt=started;lastTerminal=started;emit LaunchBound(expectedToken,started);
    }
}
