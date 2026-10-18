// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./WorkerFixtures.sol";
import {NativeShortProgram} from "../../contracts/production/native/NativeShortProgram.sol";
import {NativeMonthlyProgram} from "../../contracts/production/native/NativeMonthlyProgram.sol";
import {ShortDrandAdapter} from "../../contracts/production/ShortDrandAdapter.sol";
contract NativeEscrowFixture {
 mapping(address=>uint256) public balanceOf;
 function deposit(address recipient) external payable {balanceOf[recipient]+=msg.value;}
 function claim() external {uint256 n=balanceOf[msg.sender];balanceOf[msg.sender]=0;(bool ok,)=payable(msg.sender).call{value:n}("");require(ok);}
}
contract NativeCurveFixture {
 address public token;address public factory;address public constant pairToken=address(0);address public deployer;address public feeEscrow;
 uint256 public quoteFeeBalance;uint256 public creatorTaxBalance;bool public graduated;
 constructor(address t,address f,address d,address e){token=t;factory=f;deployer=d;feeEscrow=e;}
 function recordFees() external payable {creatorTaxBalance+=msg.value;}
 function sweepFees(uint256) external {require(msg.sender==deployer);uint256 n=creatorTaxBalance+quoteFeeBalance;creatorTaxBalance=0;quoteFeeBalance=0;NativeEscrowFixture(feeEscrow).deposit{value:n}(deployer);}
}
contract NativeRecipientFixture {
 bool public reject;address public reenter;bytes public payload;
 function configure(bool r,address target,bytes calldata data) external {reject=r;reenter=target;payload=data;}
 receive() external payable {require(!reject,"rejected");if(reenter!=address(0)){(bool ok,)=reenter.call(payload);require(!ok,"reentry succeeded");}}
}
// TEST ONLY outcome branches. Production adapter remains the unchanged BLS verifier.
contract NativeShortHarness is NativeShortProgram {
 constructor(Setup memory s,uint256[] memory w,ShortDrandAdapter.Timing memory t) NativeShortProgram(s,w,t){}
 function testSeed(bytes32 seed) external {require(pending&&!fulfilled[cycle]);verifiedSeed[cycle]=seed;fulfilled[cycle]=true;}
}
contract NativeMonthlyHarness is NativeMonthlyProgram {
 constructor(Setup memory s,ShortDrandAdapter.Timing memory t) NativeMonthlyProgram(s,t){}
 function testSeed(bytes32 seed) external {require(pending&&!fulfilled[cycle]);verifiedSeed[cycle]=seed;fulfilled[cycle]=true;}
}
