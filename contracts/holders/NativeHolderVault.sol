// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHolderSource {
    function holderFund() external view returns(address);
    function instance() external view returns(bytes32);
}

/// Funding-stage prototype. Deliberately has no payout/rescue/upgrade path.
/// NOT deployable with real funds until the entitlement/payout package is complete.
contract NativeHolderVault {
    address public constant quote = address(0);
    bytes32 public immutable instance;
    address public immutable registrar;
    address public source;
    uint256 public totalReceived;
    event SourceBound(address indexed source);
    event Deposited(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived);
    constructor(bytes32 instance_) {
        require(block.chainid==4663 && instance_!=bytes32(0),"chain/instance");
        instance=instance_;registrar=msg.sender;
    }
    function bindSource(address source_) external {
        require(msg.sender==registrar && source==address(0),"binding");
        require(source_.code.length>0 && IHolderSource(source_).holderFund()==address(this)
            && IHolderSource(source_).instance()==instance,"source");
        source=source_;emit SourceBound(source_);
    }
    function fund(uint256 amount) external payable returns(uint256) {
        require(msg.sender==source && source!=address(0),"source");
        require(amount>0 && amount==msg.value,"amount");
        totalReceived+=amount;emit Deposited(instance,msg.sender,amount,totalReceived);return amount;
    }
}
