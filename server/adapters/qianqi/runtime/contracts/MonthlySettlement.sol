// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {CutoffHistory} from "./CutoffHistory.sol";
import {ChainBlocks} from "./ChainBlocks.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PromoVault} from "./PromoVault.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {MonthlyOutcome} from "./MonthlyOutcome.sol";

interface IMonthlyControllerBinding { function monthlyController() external view returns(address); }

/// Internal monthly component. The integrating controller must authenticate the
/// publisher and one seed, and enforce finality/execution readiness before seal.
/// Interval/notice are immutable; admission policies are forward-only epochs.
abstract contract MonthlySettlement is ReentrancyGuard, CutoffHistory {
    error MonthlyBudgetNotReady();
    enum Phase { None, Publishing, Ready, WaitingSeed, Processing, Terminal, Superseded }
    struct Input {
        bytes32 drawId; bytes32 snapshotHash; bytes32 root; uint64 campaign; uint64 rulesEpoch;
        uint256 cutoff; bytes32 cutoffHash; uint256 count; uint256 attempts;
    }
    struct Month {
        Input input; Phase phase; bytes32 root; uint256 count; uint256 attempts; address lastWallet;
        bytes32 context; bytes32 seed; uint256 nextChunk; uint256 processed; uint256 admitted;
        address winner; uint256 bestRank; uint256 budget; bytes32 resultHash;
        uint256 totalWeight; uint256 processedWeight;
    }
    PromoVault public immutable monthlyVault;
    address public immutable monthlyRegistry;
    bytes32 public immutable monthlyInstance;
    uint256 public immutable monthlyInterval;
    uint256 public immutable monthlyStartedAt;
    bytes32 public immutable monthlyRulesHash;
    uint256 public immutable monthlyRulesNotice;
    struct Policy { ShortOutcome.Rules outcome; bytes32 hash; uint256 firstBlock; }
    mapping(uint64=>Policy) private policies;
    uint64 public currentMonthlyEpoch=1;
    uint64 public drainingMonthlyEpoch;
    uint64 public announcedMonthlyEpoch;
    uint256 public monthlyRulesEligibleAt;
    bytes32 public constant EMPTY_MONTHLY_ROOT=keccak256("MONTHLY_DATASET_V1");
    uint256 public constant MAX_MONTHLY_CHUNK=64;
    mapping(bytes32=>Month) private months;
    mapping(bytes32=>bytes32[]) private chunks;
    bytes32 public activeMonth;
    bytes32 public pendingMonth;
    uint256 public lastMonthAt;
    uint256 public lastMonthBlock;
    event MonthProposed(Input input);
    event MonthChunk(bytes32 indexed drawId,uint256 index,bytes32 hash);
    event MonthSuperseded(bytes32 indexed drawId);
    event MonthFrozen(bytes32 indexed drawId,bytes32 context,uint256 budget);
    event MonthSeedAccepted(bytes32 indexed drawId,bytes32 seed);
    event MonthProgress(bytes32 indexed drawId,uint256 processed,uint256 admitted);
    event AttemptsFrozen(bytes32 indexed drawId,uint8 indexed kind,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 rulesHash,bytes32 snapshotHash);
    event AttemptsConsumed(bytes32 indexed drawId,uint8 indexed kind,bytes32 snapshotHash,uint8 outcome,bytes32 resultHash);
    event MonthlyRulesPayload(uint64 indexed epoch,ShortOutcome.Rules outcome);
    event MonthlyRulesAnnounced(uint64 indexed epoch,bytes32 rulesHash,uint256 eligibleAt);
    event MonthlyRulesActivated(uint64 indexed oldEpoch,uint64 indexed newEpoch,uint256 firstNewBlock);
    event MonthlyEpochEmpty(uint64 indexed epoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash);
    constructor(address vault,address registry,bytes32 instance,uint256 interval,uint256 notice,ShortOutcome.Rules memory rules){
        require(vault!=address(0) && registry.code.length>0 && instance!=bytes32(0) && interval>0 && notice>0,"binding");
        monthlyVault=PromoVault(vault);monthlyRegistry=registry;monthlyInstance=instance;monthlyInterval=interval;
        monthlyRulesHash=MonthlyOutcome.rulesHash(rules);monthlyRulesNotice=notice;lastMonthAt=block.timestamp;monthlyStartedAt=block.timestamp;
        _storeMonthlyPolicy(1,rules);policies[1].firstBlock=ChainBlocks.number();
    }
    function month(bytes32 id) public view returns(Month memory){return months[id];}
    /// Quote base units. Concrete public deployment fixes its product minimum.
    function minimumMonthlyBudget() public pure virtual returns(uint256){return 1;}
    function monthRules() public view returns(ShortOutcome.Rules memory){return policies[currentMonthlyEpoch].outcome;}
    function monthlyEpochPolicy(uint64 epoch) public view returns(Policy memory){return policies[epoch];}
    function _storeMonthlyPolicy(uint64 epoch,ShortOutcome.Rules memory rules) private {
        policies[epoch]=Policy(rules,MonthlyOutcome.rulesHash(rules),0);emit MonthlyRulesPayload(epoch,rules);
    }
    function _announceMonthlyRules(ShortOutcome.Rules memory rules) internal nonReentrant {
        require(rules.version==policies[1].outcome.version,"monthly generation");
        require(announcedMonthlyEpoch==0 && drainingMonthlyEpoch==0,"month transition");
        uint64 next=currentMonthlyEpoch+1;_storeMonthlyPolicy(next,rules);
        announcedMonthlyEpoch=next;monthlyRulesEligibleAt=block.timestamp+monthlyRulesNotice;
        emit MonthlyRulesAnnounced(next,policies[next].hash,monthlyRulesEligibleAt);
    }
    function _activateMonthlyRules() internal nonReentrant {
        require(announcedMonthlyEpoch!=0 && block.timestamp>=monthlyRulesEligibleAt,"month notice");
        require(activeMonth==bytes32(0) && pendingMonth==bytes32(0) && block.timestamp>=lastMonthAt+monthlyInterval,"month busy/time");
        drainingMonthlyEpoch=currentMonthlyEpoch;currentMonthlyEpoch=announcedMonthlyEpoch;
        announcedMonthlyEpoch=0;monthlyRulesEligibleAt=0;policies[currentMonthlyEpoch].firstBlock=ChainBlocks.number()+1;
        emit MonthlyRulesActivated(drainingMonthlyEpoch,currentMonthlyEpoch,ChainBlocks.number()+1);
    }
    /// Authorized publisher assertion only; independent replay must prove old OPEN is empty.
    function _closeEmptyMonthlyEpoch(uint256 cutoff,bytes32 cutoffHash,bytes32 snapshotHash) internal nonReentrant {
        require(drainingMonthlyEpoch!=0 && activeMonth==bytes32(0) && pendingMonth==bytes32(0),"month phase");
        require(cutoff>=policies[currentMonthlyEpoch].firstBlock && validCutoff(cutoff,cutoffHash) && snapshotHash!=bytes32(0),"month cutoff");
        emit MonthlyEpochEmpty(drainingMonthlyEpoch,cutoff,cutoffHash,snapshotHash);drainingMonthlyEpoch=0;
        // An administrative empty closure is not a draw: preserve lastMonthAt/Block.
    }
    function monthChunkCount(bytes32 id) external view returns(uint256){return chunks[id].length;}
    function monthChunkHash(bytes32 id,uint256 index) external view returns(bytes32){return chunks[id][index];}
    function _beginMonth(Input calldata input) internal nonReentrant {
        uint64 target=drainingMonthlyEpoch!=0?drainingMonthlyEpoch:currentMonthlyEpoch;
        require(input.rulesEpoch==target && input.cutoff>=policies[currentMonthlyEpoch].firstBlock,"month epoch");
        require(activeMonth==bytes32(0) && pendingMonth==bytes32(0) && block.timestamp>=lastMonthAt+monthlyInterval,"month busy/time");
        require(address(monthlyVault).code.length>0 && IMonthlyControllerBinding(address(monthlyVault)).monthlyController()==address(this),"vault");
        monthlyVault.validateDrawId(input.drawId,1);
        require(input.drawId!=bytes32(0) && months[input.drawId].phase==Phase.None && input.snapshotHash!=bytes32(0)
            && input.root!=bytes32(0) && input.campaign>0 && input.count>0 && input.attempts>=input.count,"month input");
        require(input.cutoff>=lastMonthBlock && validCutoff(input.cutoff,input.cutoffHash),"month cutoff");
        Month storage m=months[input.drawId];m.input=input;m.phase=Phase.Publishing;
        m.root=EMPTY_MONTHLY_ROOT;activeMonth=input.drawId;emit MonthProposed(input);
    }
    function _publishMonth(bytes32 id,ShortOutcome.Participant[] calldata chunk) internal nonReentrant {
        Month storage m=months[id];require(activeMonth==id && m.phase==Phase.Publishing,"month phase");
        require(chunk.length>0 && chunk.length<=MAX_MONTHLY_CHUNK && m.count+chunk.length<=m.input.count,"month chunk");
        for(uint256 i;i<chunk.length;++i){
            ShortOutcome.Participant calldata p=chunk[i];
            require(p.wallet>m.lastWallet && p.wallet!=address(monthlyVault) && p.firstAttempt>0 && p.lastAttempt>=p.firstAttempt,"month participant");
            m.root=keccak256(abi.encode(m.root,p.wallet,p.firstAttempt,p.lastAttempt));m.lastWallet=p.wallet;
            m.attempts+=uint256(p.lastAttempt)-p.firstAttempt+1;
            if(policies[m.input.rulesEpoch].outcome.version==2)
                m.totalWeight+=MonthlyOutcome.weight(uint256(p.lastAttempt)-p.firstAttempt+1);
        }
        m.count+=chunk.length;require(m.attempts<=m.input.attempts,"month attempts");
        bytes32 digest=keccak256(abi.encode(chunk));emit MonthChunk(id,chunks[id].length,digest);chunks[id].push(digest);
        if(m.count==m.input.count){require(m.root==m.input.root && m.attempts==m.input.attempts,"month commitment");m.phase=Phase.Ready;}
    }
    function _supersedeMonth(bytes32 id) internal nonReentrant {
        Month storage m=months[id];require(activeMonth==id && (m.phase==Phase.Publishing || m.phase==Phase.Ready),"month phase");
        m.phase=Phase.Superseded;activeMonth=bytes32(0);emit MonthSuperseded(id);
    }
    function _sealMonth(bytes32 id) internal nonReentrant {
        Month storage m=months[id];require(activeMonth==id && pendingMonth==bytes32(0) && m.phase==Phase.Ready,"month ready");
        monthlyVault.startMonthly(id,m.input.campaign);(,,,m.budget,,)=monthlyVault.draws(id);
        // startMonthly recognizes direct funding. A failed minimum rolls back all
        // reserve changes before a random request can be made.
        if(m.budget<minimumMonthlyBudget())revert MonthlyBudgetNotReady();
        m.context=keccak256(abi.encode(keccak256("MONTHLY_DATASET_CONTEXT_V2"),block.chainid,address(this),monthlyInstance,
            monthlyRegistry,address(monthlyVault),monthlyVault.quoteToken(),m.input,policies[m.input.rulesEpoch].hash,m.budget));
        m.phase=Phase.WaitingSeed;pendingMonth=id;activeMonth=bytes32(0);
        emit AttemptsFrozen(id,1,m.input.cutoff,m.input.cutoffHash,policies[m.input.rulesEpoch].hash,m.input.snapshotHash);
        emit MonthFrozen(id,m.context,m.budget);
    }
    /// Authenticated RNG wrapper only. Zero seed valid, repeat delivery forbidden.
    function _acceptMonthlySeed(bytes32 id,bytes32 seed) internal nonReentrant {
        Month storage m=months[id];require(pendingMonth==id && m.phase==Phase.WaitingSeed,"month seed");
        m.seed=seed;m.phase=Phase.Processing;emit MonthSeedAccepted(id,seed);
    }
    function processMonth(bytes32 id,uint256 index,ShortOutcome.Participant[] calldata chunk) external nonReentrant {
        Month storage m=months[id];require(m.phase==Phase.Processing && pendingMonth==id && index==m.nextChunk
            && index<chunks[id].length && keccak256(abi.encode(chunk))==chunks[id][index],"month progress");
        uint256 admitted;
        if(policies[m.input.rulesEpoch].outcome.version==2){
            bool payout=MonthlyOutcome.pays(m.context,m.seed);
            uint256 point=MonthlyOutcome.selection(m.context,m.seed,m.totalWeight);
            for(uint256 i;i<chunk.length;++i){
                uint256 next=m.processedWeight+MonthlyOutcome.weight(uint256(chunk[i].lastAttempt)-chunk[i].firstAttempt+1);
                if(payout && point>=m.processedWeight && point<next)m.winner=chunk[i].wallet;
                m.processedWeight=next;
            }
            // Compatibility field: all wallets participate in the payout branch.
            admitted=payout?chunk.length:0;
        }else{
            ShortOutcome.Candidate[] memory selected;
            (selected,admitted)=ShortOutcome.selectTopK(m.context,m.seed,chunk,policies[m.input.rulesEpoch].outcome,1);
            if(admitted>0 && (m.winner==address(0) || selected[0].rank<m.bestRank || (selected[0].rank==m.bestRank && selected[0].wallet<m.winner))){
                m.winner=selected[0].wallet;m.bestRank=selected[0].rank;
            }
        }
        m.processed+=chunk.length;m.admitted+=admitted;++m.nextChunk;emit MonthProgress(id,m.processed,m.admitted);
    }
    function finishMonth(bytes32 id) external nonReentrant {
        Month storage m=months[id];require(pendingMonth==id && m.phase==Phase.Processing
            && m.processed==m.count && m.nextChunk==chunks[id].length,"month unfinished");
        bool v2=policies[m.input.rulesEpoch].outcome.version==2;
        if(v2)require(m.totalWeight>0 && m.processedWeight==m.totalWeight
            && ((m.winner!=address(0))==MonthlyOutcome.pays(m.context,m.seed)),"monthly result");
        monthlyVault.settleMonthly(id,m.winner);
        m.resultHash=keccak256(abi.encode(v2?keccak256("MONTHLY_RESULT_V2"):keccak256("MONTHLY_RESULT_V1"),m.context,m.seed,m.root,m.winner,m.admitted,m.budget));
        m.phase=Phase.Terminal;pendingMonth=bytes32(0);lastMonthAt=block.timestamp;lastMonthBlock=ChainBlocks.number();
        if(drainingMonthlyEpoch==m.input.rulesEpoch)drainingMonthlyEpoch=0;
        emit AttemptsConsumed(id,1,m.input.snapshotHash,m.winner==address(0)?0:1,m.resultHash);
    }
}
