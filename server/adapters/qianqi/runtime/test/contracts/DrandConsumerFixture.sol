// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DrandRandomAdapter} from "../../contracts/DrandRandomAdapter.sol";
contract DrandConsumerFixture {
    DrandRandomAdapter public adapter;
    bool public fail;
    bool public reenter;
    uint256 public calls;
    bytes32 public seed;
    uint256 public id;
    function bind(address a) external {require(address(adapter)==address(0));adapter=DrandRandomAdapter(a);}
    function configure(bool f,bool r) external {fail=f;reenter=r;}
    function request(bytes32 context) external {id=adapter.request(context);}
    function fulfill(uint256 key,bytes32 value) external {
        require(msg.sender==address(adapter)&&key==id&&!fail,"callback");
        if(reenter)adapter.deliver(key);
        calls++;seed=value;
    }
}
