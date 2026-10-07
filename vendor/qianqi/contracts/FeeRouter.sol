// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPairNativeVault {
    function projectToken() external view returns (address);
    function epoch() external view returns (uint64);
    function epochRecipientCount(uint64 which) external view returns (uint256);
    function epochRecipient(uint64 which, uint256 index) external view returns (address, uint16);
    function positions(uint256 id) external view returns (bool registered, address quote, bytes32 poolId);
    function positionManager() external view returns (address);
    function collectFees(uint256 positionId) external;
    function claimable(uint64 which, address recipient, address asset) external view returns (uint256);
    function claim(address asset, uint64 which) external returns (uint256);
}

interface IPairPositionOwner {
    function ownerOf(uint256 id) external view returns (address);
}

/// @notice Prototype for standard TOKEN/USDG assets and PAIR native fee vaults.
/// Revenue is attributed when recognized by this router, not when a swap occurred.
/// Direct transfers are recognized by sync/harvest or before a policy transition.
contract FeeRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Policy {
        uint64 endsAt;
        address[3] recipients; // PromoVault, InvestorVault, Treasury
        uint16[3] bps;
    }
    address public immutable projectToken;
    address public immutable quoteToken;
    IPairNativeVault public pairVault;
    uint256 public positionId;
    uint64 public sourceEpoch;
    uint64 public campaignId = 1;
    mapping(uint64 => Policy) private policies;
    mapping(uint64 => mapping(address => uint256)) public received;
    mapping(address => uint256) public accounted; // unpaid credits plus rounding reserve
    mapping(address => mapping(address => uint256)) public credit;

    error InvalidConfiguration();
    error UnsupportedAsset();
    error AlreadyBound();
    error NotBound();
    error CampaignActive();
    error StaleCampaign();
    error SourceEpochChanged();
    error IncompleteClaim();
    error BalanceDeficit();
    event SourceBound(address indexed vault, uint256 positionId, uint64 pairEpoch);
    event CampaignOpened(uint64 indexed campaignId, uint64 endsAt, address[3] recipients, uint16[3] bps);
    event RevenueRecognized(uint64 indexed campaignId, address indexed asset, uint256 amount);
    event Credited(uint64 indexed campaignId, address indexed asset, address indexed recipient, uint256 amount);
    event Paid(address indexed asset, address indexed recipient, uint256 amount);
    event PairClaimed(uint64 indexed pairEpoch, address indexed asset, uint256 receivedAmount);
    event CampaignClosed(uint64 indexed campaignId, uint256 tokenRevenue, uint256 quoteRevenue);

    constructor(address admin, address token, address quote, Policy memory initial)
        Ownable(admin)
    {
        if (token == address(0) || quote == address(0) || token == quote) revert InvalidConfiguration();
        projectToken = token;
        quoteToken = quote;
        _setPolicy(initial);
    }

    function policy(uint64 id) external view returns (Policy memory) { return policies[id]; }

    /// One-time binding after launch. Admin must verify vault and position against launch receipt.
    function bindSource(address vault, uint256 position) external onlyOwner nonReentrant {
        if (address(pairVault) != address(0)) revert AlreadyBound();
        if (vault.code.length == 0 || projectToken.code.length == 0 || quoteToken.code.length == 0)
            revert InvalidConfiguration();
        IPairNativeVault source = IPairNativeVault(vault);
        if (source.projectToken() != projectToken) revert InvalidConfiguration();
        uint64 e = source.epoch();
        if (source.epochRecipientCount(e) != 1) revert InvalidConfiguration();
        (address recipient, uint16 share) = source.epochRecipient(e, 0);
        if (recipient != address(this) || share != 10000) revert InvalidConfiguration();
        (bool registered, address quote, bytes32 poolId) = source.positions(position);
        if (position == 0 || !registered || quote != quoteToken || poolId == bytes32(0))
            revert InvalidConfiguration();
        // The verified native vault validates PoolKey when registering a position.
        // Recheck current NFT custody before committing the irreversible binding.
        if (IPairPositionOwner(source.positionManager()).ownerOf(position) != vault)
            revert InvalidConfiguration();
        pairVault = source;
        positionId = position;
        sourceEpoch = e;
        emit SourceBound(vault, position, e);
    }

    /// Collection changes PAIR custody/accounting, not this router's campaign attribution.
    function collect() external nonReentrant {
        if (address(pairVault) == address(0)) revert NotBound();
        pairVault.collectFees(positionId);
    }

    function harvest(address asset, uint64 pairEpoch) external nonReentrant {
        _asset(asset);
        if (address(pairVault) == address(0)) revert NotBound();
        _harvest(asset, pairEpoch);
    }

    function _harvest(address asset, uint64 pairEpoch) private {
        uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
        uint256 due = pairVault.claimable(pairEpoch, address(this), asset);
        if (due != 0) pairVault.claim(asset, pairEpoch);
        uint256 afterBalance = IERC20(asset).balanceOf(address(this));
        if (afterBalance < beforeBalance) revert BalanceDeficit();
        if (afterBalance - beforeBalance != due || pairVault.claimable(pairEpoch, address(this), asset) != 0)
            revert IncompleteClaim();
        emit PairClaimed(pairEpoch, asset, afterBalance - beforeBalance);
        _sync(asset);
    }

    function sync(address asset) external nonReentrant {
        _asset(asset);
        _sync(asset);
    }

    /// Anyone may trigger payment, but cannot redirect the beneficiary or spend its credit twice.
    function pay(address asset, address recipient) external nonReentrant {
        _asset(asset);
        uint256 amount = credit[asset][recipient];
        if (amount == 0) return;
        credit[asset][recipient] = 0;
        accounted[asset] -= amount;
        IERC20(asset).safeTransfer(recipient, amount);
        emit Paid(asset, recipient, amount);
    }

    /// Successful rollover, not endsAt, is the accounting boundary. No payouts are required.
    function rollCampaign(uint64 expectedCampaignId, Policy calldata next) external onlyOwner nonReentrant {
        if (expectedCampaignId != campaignId) revert StaleCampaign();
        if (block.timestamp < policies[campaignId].endsAt) revert CampaignActive();
        if (address(pairVault) == address(0)) revert NotBound();
        if (pairVault.epoch() != sourceEpoch) revert SourceEpochChanged();
        pairVault.collectFees(positionId);
        _harvest(projectToken, sourceEpoch);
        _harvest(quoteToken, sourceEpoch);
        if (pairVault.epoch() != sourceEpoch) revert SourceEpochChanged();
        if (pairVault.claimable(sourceEpoch, address(this), projectToken) != 0 ||
            pairVault.claimable(sourceEpoch, address(this), quoteToken) != 0) revert IncompleteClaim();
        _sync(projectToken);
        _sync(quoteToken);
        _closeRounding(projectToken);
        _closeRounding(quoteToken);
        emit CampaignClosed(campaignId, received[campaignId][projectToken], received[campaignId][quoteToken]);
        ++campaignId;
        _setPolicy(next);
    }

    function _setPolicy(Policy memory p) private {
        if (p.endsAt <= block.timestamp || uint256(p.bps[0]) + p.bps[1] + p.bps[2] != 10000)
            revert InvalidConfiguration();
        // Promo receives the final rounding reserve (at most two raw units per asset/campaign).
        if (p.recipients[0] == address(0)) revert InvalidConfiguration();
        for (uint256 i; i < 3; ++i) {
            if (p.recipients[i] == address(this) || (p.bps[i] != 0 && p.recipients[i] == address(0)))
                revert InvalidConfiguration();
        }
        policies[campaignId] = p;
        emit CampaignOpened(campaignId, p.endsAt, p.recipients, p.bps);
    }

    function _asset(address asset) private view {
        if (asset != projectToken && asset != quoteToken) revert UnsupportedAsset();
    }

    function _sync(address asset) private {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        if (balance < accounted[asset]) revert BalanceDeficit();
        uint256 amount = balance - accounted[asset];
        if (amount == 0) return;
        uint256 beforeTotal = received[campaignId][asset];
        uint256 total = beforeTotal + amount;
        received[campaignId][asset] = total;
        accounted[asset] = balance;
        Policy storage p = policies[campaignId];
        for (uint256 i; i < 3; ++i) {
            uint256 delta = Math.mulDiv(total, p.bps[i], 10000) - Math.mulDiv(beforeTotal, p.bps[i], 10000);
            _credit(asset, p.recipients[i], delta);
        }
        emit RevenueRecognized(campaignId, asset, amount);
    }

    function _closeRounding(address asset) private {
        uint256 total = received[campaignId][asset];
        Policy storage p = policies[campaignId];
        uint256 allocated;
        for (uint256 i; i < 3; ++i) allocated += Math.mulDiv(total, p.bps[i], 10000);
        _credit(asset, p.recipients[0], total - allocated);
    }

    function _credit(address asset, address recipient, uint256 amount) private {
        if (amount == 0) return;
        credit[asset][recipient] += amount;
        emit Credited(campaignId, asset, recipient, amount);
    }
}
