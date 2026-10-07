// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {BLS} from "./vendor/drand/BLS.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILocalRandom} from "./ILocalRandom.sol";
interface IDrandConsumer { function fulfill(uint256 id,bytes32 seed) external; }

/// One evmnet round per request. Clock freshness/finality are operational assumptions,
/// NOT guaranteed by ready(). No administrator, cancellation, replacement or prize custody.
contract DrandRandomAdapter is ILocalRandom, ReentrancyGuard {
    bytes32 public constant PROFILE = keccak256("drand-evmnet-operational-v1");
    bytes32 public constant CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    bytes public constant DST = "BLS_SIG_BN254G1_XMD:KECCAK-256_SVDW_RO_NUL_";
    uint256 public constant GENESIS = 1727521075;
    uint256 public constant PERIOD = 3;
    uint256 public constant fee = 0; // Delivery gas is paid by the external executor.
    address public immutable shortConsumer;
    address public immutable monthlyConsumer;
    uint256 public immutable leadSeconds;
    uint256 public immutable maxClockLag;
    uint256 public immutable maxClockAhead;
    uint256 public immutable maxFinalizedLag;
    uint256 public immutable maxBeaconLag;
    struct Timing { uint256 lead; uint256 clockLag; uint256 clockAhead; uint256 finalizedLag; uint256 beaconLag; }
    struct Request { address consumer; bytes32 context; uint64 round; bool proven; bool delivered; bytes32 seed; }
    mapping(uint256=>Request) public requests;
    mapping(address=>mapping(bytes32=>uint256)) public contextRequest;
    uint256 public nextId;
    event Requested(uint256 indexed id,address indexed consumer,bytes32 indexed context,uint64 round);
    event Proven(uint256 indexed id,bytes32 seed);
    event Delivered(uint256 indexed id);
    constructor(address short_,address monthly_,Timing memory t){
        require(short_!=address(0)&&monthly_!=address(0)&&short_!=monthly_,"consumers");
        require(t.lead>t.clockLag+t.finalizedLag+t.clockAhead&&t.lead<=30 days&&t.clockLag>0&&t.finalizedLag>0&&t.beaconLag>0,"timing");
        shortConsumer=short_;monthlyConsumer=monthly_;leadSeconds=t.lead;maxClockLag=t.clockLag;
        maxClockAhead=t.clockAhead;maxFinalizedLag=t.finalizedLag;maxBeaconLag=t.beaconLag;
    }
    function ready() external view returns(bool){return block.timestamp>=GENESIS;}
    function request(bytes32 context) external payable nonReentrant returns(uint256 id){
        require((msg.sender==shortConsumer||msg.sender==monthlyConsumer)&&msg.sender.code.length>0,"consumer");
        require(msg.value==0&&context!=bytes32(0)&&contextRequest[msg.sender][context]==0&&block.timestamp>=GENESIS,"request");
        uint256 round=1+(block.timestamp+leadSeconds+1-GENESIS+PERIOD-1)/PERIOD;
        require(round<=type(uint64).max,"round");id=++nextId;
        requests[id]=Request(msg.sender,context,uint64(round),false,false,bytes32(0));
        contextRequest[msg.sender][context]=id;emit Requested(id,msg.sender,context,uint64(round));
    }
    function verify(uint64 round,bytes calldata signature) public view returns(bool){
        if(round==0||signature.length!=64)return false;
        uint256[2] memory sig=abi.decode(signature,(uint256[2]));if(!BLS.isValidSignature(sig))return false;
        uint256[4] memory key=[
            uint256(0x0557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f),
            uint256(0x07e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b382),
            uint256(0x297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b),
            uint256(0x0095685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6)];
        uint256[2] memory message=BLS.hashToPoint(DST,abi.encodePacked(keccak256(abi.encodePacked(round))));
        (bool valid,bool success)=BLS.verifySingle(sig,key,message);return valid&&success;
    }
    // Proof storage and callback are separate: callback failure cannot lose or replace seed.
    function prove(uint256 id,bytes calldata signature) external nonReentrant returns(bytes32 seed){
        Request storage r=requests[id];require(r.consumer!=address(0),"unknown");
        require(block.timestamp>=GENESIS+(uint256(r.round)-1)*PERIOD,"not due");
        require(verify(r.round,signature),"proof");
        seed=keccak256(abi.encode(CHAIN_HASH,sha256(signature),block.chainid,address(this),id,r.consumer,r.context));
        if(r.proven){require(r.seed==seed,"seed");return seed;}
        r.proven=true;r.seed=seed;emit Proven(id,seed);
    }
    function deliver(uint256 id) external nonReentrant {
        Request storage r=requests[id];require(r.proven,"not proven");if(r.delivered)return;
        r.delivered=true;IDrandConsumer(r.consumer).fulfill(id,r.seed);emit Delivered(id);
    }
}
