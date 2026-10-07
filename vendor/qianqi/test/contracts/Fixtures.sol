// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockToken is ERC20 {
    address public blocked;
    address public callback;
    bytes public callbackData;
    bool public reentrySucceeded;
    constructor() ERC20("Fixture", "FIX") {}
    function mint(address to, uint256 value) external { _mint(to, value); }
    function burn(address from, uint256 value) external { _burn(from, value); }
    function blockRecipient(address to) external { blocked = to; }
    function setCallback(address to, bytes calldata data) external { callback = to; callbackData = data; }
    function _update(address from, address to, uint256 value) internal override {
        require(to != blocked, "blocked recipient");
        super._update(from, to, value);
        if (callback != address(0) && (from == callback || to == callback)) {
            (reentrySucceeded,) = callback.call(callbackData);
        }
    }
}

/// Funding-only negative fixture: takes one raw unit from each nonzero transfer.
contract ShortTransferToken is ERC20 {
    constructor() ERC20("Short transfer", "SHORT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value != 0) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else super._update(from, to, value);
    }
}

/// Test custody endpoint only: no production reward accounting or winner selection.
contract PromoVaultFixture {}

contract MockPairVault {
    address public projectToken;
    address public recipient;
    uint64 public epoch = 1;
    mapping(address => uint256) public due;
    mapping(address => uint256) public queued;
    address[] private queuedAssets;
    bool public failCollect;
    address public failClaimAsset;
    bool public shortClaim;
    uint256 public collections;
    address public callback;
    bytes public callbackData;
    bytes public callbackResult;
    bool public callbackSucceeded;
    constructor(address token, address to) { projectToken = token; recipient = to; }
    bool public positionRegistered = true;
    address public positionQuoteOverride;
    address public positionOwnerOverride;
    function setPosition(bool registered, address quote, address owner) external {
        positionRegistered = registered; positionQuoteOverride = quote; positionOwnerOverride = owner;
    }
    function positions(uint256 id) external view returns (bool, address, bytes32) {
        (bool ok, bytes memory result) = recipient.staticcall(abi.encodeWithSignature("quoteToken()"));
        address quote = positionQuoteOverride;
        if (quote == address(0) && ok && result.length == 32) quote = abi.decode(result,(address));
        return (id == 123 && positionRegistered, quote, bytes32(uint256(1)));
    }
    function positionManager() external view returns (address) { return address(this); }
    function ownerOf(uint256 id) external view returns (address) {
        require(id == 123, "unknown NFT");
        return positionOwnerOverride == address(0) ? address(this) : positionOwnerOverride;
    }
    function epochRecipientCount(uint64) external pure returns (uint256) { return 1; }
    function epochRecipient(uint64, uint256) external view returns (address, uint16) { return (recipient,10000); }
    function fund(address asset, uint256 amount) external {
        MockToken(asset).mint(address(this), amount); due[asset] += amount;
    }
    function setEpoch(uint64 value) external { epoch = value; }
    function setFailures(bool collectFail, address claimFail, bool shortPay) external {
        failCollect = collectFail; failClaimAsset = claimFail; shortClaim = shortPay;
    }
    function queueFees(address asset, uint256 amount) external {
        if (queued[asset] == 0) queuedAssets.push(asset);
        queued[asset] += amount;
    }
    function setCallback(address target, bytes calldata data) external { callback = target; callbackData = data; }
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) assembly { revert(add(result,32), mload(result)) }
        return result;
    }
    function _callback() private {
        if (callback != address(0)) (callbackSucceeded, callbackResult) = callback.call(callbackData);
    }
    function collectFees(uint256 position) external {
        require(position == 123, "wrong position");
        require(!failCollect, "collect failure");
        ++collections;
        _callback();
        for (uint256 i; i < queuedAssets.length; ++i) {
            address asset = queuedAssets[i];
            uint256 amount = queued[asset];
            queued[asset] = 0;
            MockToken(asset).mint(address(this), amount);
            due[asset] += amount;
        }
        delete queuedAssets;
    }
    function claimable(uint64 which, address to, address asset) external view returns (uint256) {
        return which == 1 && to == recipient ? due[asset] : 0;
    }
    function claim(address asset, uint64 which) external returns (uint256) {
        require(msg.sender == recipient && which == 1, "wrong claimant");
        require(asset != failClaimAsset, "claim failure");
        _callback();
        uint256 amount = due[asset]; due[asset] = 0;
        IERC20(asset).transfer(recipient, shortClaim && amount > 0 ? amount - 1 : amount);
        return type(uint256).max; // router must measure balance, not trust this value
    }
}

interface IPoolManagerFixture {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

/// Test-only swap helper for producing actual fees on the local fork.
contract SwapFixture {
    IPoolManagerFixture public immutable manager;
    constructor(address m) { manager = IPoolManagerFixture(m); }
    function trade(IPoolManagerFixture.PoolKey calldata key, bool zeroForOne, uint256 amount) external {
        manager.unlock(abi.encode(key, zeroForOne, amount, msg.sender));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (IPoolManagerFixture.PoolKey memory key, bool direction, uint256 amount, address payer) =
            abi.decode(data, (IPoolManagerFixture.PoolKey, bool, uint256, address));
        int256 delta = manager.swap(key, IPoolManagerFixture.SwapParams(direction, -int256(amount),
            direction ? 4295128740 : 1461446703485210103287273052203988822378723970341), "");
        _settle(key.currency0, int128(delta >> 128), payer);
        _settle(key.currency1, int128(delta), payer);
        return abi.encode(delta);
    }
    function _settle(address currency, int128 delta, address payer) private {
        if (delta < 0) {
            manager.sync(currency);
            IERC20(currency).transferFrom(payer, address(manager), uint256(-int256(delta)));
            manager.settle();
        } else if (delta > 0) manager.take(currency, payer, uint128(delta));
    }
}
