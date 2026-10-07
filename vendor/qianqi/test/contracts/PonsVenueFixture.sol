// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IPonsFactory,IPonsHook} from "../../contracts/IPonsVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IPonsFixtureEscrow { function fund(address,address,uint256) external; }
// One fixture implements three endpoints; live fork independently validates the real graph.
contract PonsVenueFixture {
    IPonsFactory.Launch private l;
    address public feeEscrow;
    bool public blocked;
    bool public pending;
    uint256 public quoteFeeBalance;
    uint256 public creatorTaxBalance;
    function configure(address t,address q,address recipient,address e) external {
        l=IPonsFactory.Launch(t,address(this),msg.sender,recipient,q,8090000000,0,200,300,false,0,0,0,0,true);
        feeEscrow=e;
    }
    function setState(uint8 phase,bool p,bool b) external {l.phase=phase;pending=p;blocked=b;}
    function setRecipient(address r) external {l.creatorFeeRecipient=r;}
    function setQuote(address q) external {l.pairToken=q;}
    function fund(uint256 amount) external {quoteFeeBalance+=amount;}
    function getLaunchedToken(address) external view returns(IPonsFactory.Launch memory){return l;}
    function memeHook() external view returns(address){return address(this);}
    function factory() external view returns(address){return address(this);}
    function feePolicy() external view returns(address){return address(this);}
    function token() external view returns(address){return l.token;}
    function pairToken() external view returns(address){return l.pairToken;}
    function deployer() external view returns(address){return l.creatorFeeRecipient;}
    function buybackEnabled() external pure returns(bool){return false;}
    function creatorTaxBps() external pure returns(uint256){return 300;}
    function launches(bytes32) external view returns(IPonsHook.LaunchInfo memory){
        return IPonsHook.LaunchInfo(true,l.token<l.pairToken,l.token,l.pairToken,l.creatorFeeRecipient,
            l.creatorFeeRecipient,address(1),300,3000,5000,100,300,false);
    }
    function pendingFees(bytes32,address currency) external view returns(uint256){
        return currency==l.token?(pending?1:0):quoteFeeBalance;
    }
    function pendingCreatorTax(bytes32,address) external pure returns(uint256){return 0;}
    function pendingBuyback(bytes32,address) external pure returns(uint256){return 0;}
    function sweepFees(uint256) external {require(l.phase==0);_sweep();}
    function sweepPoolFees(bytes32,uint256,uint256) external {require(l.phase==2&&!pending);_sweep();}
    function _sweep() private {
        require(!blocked&&msg.sender==l.creatorFeeRecipient);
        uint256 n=quoteFeeBalance;quoteFeeBalance=0;
        require(IERC20(l.pairToken).transfer(feeEscrow,n));
        IPonsFixtureEscrow(feeEscrow).fund(msg.sender,l.pairToken,n);
    }
}
