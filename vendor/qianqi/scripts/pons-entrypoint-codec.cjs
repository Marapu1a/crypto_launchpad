// Pinned ERC-4337 v0.7 / Alchemy SMA7702 execution family.
const E=require('ethers');
const ENTRY='0x0000000071727de22e5e9d8baf0edac6f37da032';
const IMPLEMENTATION='0x69007702764179f14f51cdce752f4f775d74e139';
const ENTRY_HASH='0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58';
const IMPLEMENTATION_HASH='0xecfc0328ce4d953a4d452e11f54b578fa2d7f2f8126246d1120ca24d11845081';
const OP='(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)';
const ENTRY_ABI=new E.Interface([`function handleOps(${OP}[] ops,address beneficiary)`,`function getUserOpHash(${OP} userOp) view returns(bytes32)`,'function getNonce(address,uint192) view returns(uint256)','event BeforeExecution()','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
const ACCOUNT=new E.Interface(['function execute(address target,uint256 value,bytes data) payable returns(bytes)','function entryPoint() view returns(address)']);
function userOpHash(op,chainId){
 const c=E.AbiCoder.defaultAbiCoder();
 const inner=E.keccak256(c.encode(['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32','bytes32'],[op.sender,op.nonce,E.keccak256(op.initCode),E.keccak256(op.callData),op.accountGasLimits,op.preVerificationGas,op.gasFees,E.keccak256(op.paymasterAndData)]));
 return E.keccak256(c.encode(['bytes32','address','uint256'],[inner,ENTRY,chainId]));
}
module.exports={ENTRY,IMPLEMENTATION,ENTRY_HASH,IMPLEMENTATION_HASH,OP,ENTRY_ABI,ACCOUNT,userOpHash};
