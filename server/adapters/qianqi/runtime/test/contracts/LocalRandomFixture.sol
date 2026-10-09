// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILocalConsumer {
    function fulfill(uint256 key, bytes32 seed) external;
}

/// Deliberately controllable randomness. Never use with real funds.
contract LocalRandomFixture {
    bool public ready = true;
    uint256 public constant fee = 1;
    uint256 public nextId;
    bool public fail;
    bool public synchronous;
    bool public callbackSucceeded;
    mapping(uint256 => address) public requesters;
    mapping(uint256 => bytes32) public contexts;
    constructor() { require(block.chainid == 31337, "local only"); }
    function setReady(bool value) external { ready = value; }
    function setFailure(bool value) external { fail = value; }
    function setSynchronous(bool value) external { synchronous = value; }
    function request(bytes32 context) external payable returns (uint256 key) {
        require(!fail && ready && msg.value == fee, "provider failure");
        key = ++nextId; requesters[key] = msg.sender; contexts[key] = context;
        if (synchronous) {
            (callbackSucceeded,) = msg.sender.call(abi.encodeCall(ILocalConsumer.fulfill, (key, bytes32(0))));
        }
    }
    function deliver(uint256 key, bytes32 seed) external {
        require(requesters[key] != address(0), "unknown request");
        ILocalConsumer(requesters[key]).fulfill(key, seed);
    }
}
