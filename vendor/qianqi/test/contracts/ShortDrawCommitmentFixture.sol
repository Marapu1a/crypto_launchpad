// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortDrawCommitment} from "../../contracts/ShortDrawCommitment.sol";
import {PromoVault} from "../../contracts/PromoVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev UNRESTRICTED test adapter. Never deploy this as a production controller.
contract ShortDrawCommitmentFixture is ShortDrawCommitment {
    BasketRules private fixtureRules;
    bytes32 public shortRulesHash;
    constructor(address vault, address registry, bytes32 instance, uint256[] memory weights,
        uint256 minUnit, bytes32 remainingRulesHash)
        ShortDrawCommitment(vault, registry, instance) {
        fixtureRules = BasketRules(weights, minUnit, remainingRulesHash);
        shortRulesHash = basketRulesHash(fixtureRules);
    }
    function freeze(FreezeRequest calldata request) external { _freezeShort(request, fixtureRules); }
    function prepareCredit(bytes32 drawId, address winner, uint256 amount) external nonReentrant {
        promoVault.reserveUSDG(drawId, 1, PromoVault.ReserveSource.SHORT, amount);
        address[] memory winners = new address[](1); winners[0] = winner;
        uint256[] memory amounts = new uint256[](1); amounts[0] = amount;
        promoVault.finalize(drawId, winners, amounts);
    }
    function startMonthly(bytes32 drawId) external nonReentrant { promoVault.startMonthly(drawId, 1); }
    function settleMonthly(bytes32 drawId, address winner) external nonReentrant { promoVault.settleMonthly(drawId, winner); }
}

/// balanceOf is STATICCALL inside real PromoVault.reserveUSDG. Require the exact
/// guard error, so an incidental static-context write failure cannot pass the test.
contract ShortBalanceCallbackToken is ERC20 {
    address private target;
    bytes private payload;
    constructor() ERC20("Callback fixture", "CB") {}
    function mint(address to, uint256 value) external { _mint(to, value); }
    function setProbe(address to, bytes calldata data) external { target = to; payload = data; }
    function balanceOf(address who) public view override returns (uint256) {
        if (target != address(0)) {
            (bool ok, bytes memory result) = target.staticcall(payload);
            require(!ok && result.length == 4
                && bytes4(result) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "guard not active");
        }
        return super.balanceOf(who);
    }
}
