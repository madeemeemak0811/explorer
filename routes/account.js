var express = require('express');
var router = express.Router();

var async = require('async');
var Web3 = require('web3');

var BigNumber = require('bignumber.js');

const kInitialMaxBlocks = 1000;
const kMinBlocksToProcess = 2000;
const kMaxBlocksToProcess = 6000;
const kMaxIterations = 600;

const kDefaultTargetNumberOfTransactions = 1000;

function GetAccountInfo(req, res, next)
{
  var T0 = Date.now();
  console.log("-----------------------------------------------------------------")
  console.log("T0: %d", T0)

  var T1 = T0;
  var T2 = T0;
  var T3 = T0;
  var T4 = T0;
  var T5 = T0;
  var T6 = T0;
  var T7 = T0;
  
  var targetNumberOfTransactions = kDefaultTargetNumberOfTransactions;
  
  if (req.params.targetNumberOfTransactions)
    targetNumberOfTransactions = req.params.targetNumberOfTransactions;

  var config = req.app.get('config');  
  var web3 = new Web3();
  web3.setProvider(config.provider);
  
  var db = req.app.get('db');
  
  var data = {};
  var blockOffsets = [];
  
  var accountLowercase = req.params.account.toLowerCase();

  function getTransactions(toBlock, callback)
  {
    async.series([
      function(callback)
      {
        web3.trace.filter({ "fromBlock": "0x" + data.fromBlock.toString(16),
                            "toBlock": "0x" + toBlock.toString(16),
                            "fromAddress": [ accountLowercase ] },
                          function(err, traces)
                          {
                            if (traces)
                            {
                              traces.forEach(function(trace)
                              {
                                if (trace.action.from == accountLowercase)
                                  data.tracesSent.push(trace);
                              });
                            }

                            callback(err);
                          });
      },
      function(callback)
      {
        web3.trace.filter({ "fromBlock": "0x" + data.fromBlock.toString(16),
                            "toBlock": "0x" + toBlock.toString(16),
                            "toAddress": [ accountLowercase ] },
                          function(err, traces)
                          {
                            if (traces)
                            {
                              traces.forEach(function(trace)
                              {
                                if (trace.action.author == accountLowercase ||
                                    trace.action.to == accountLowercase)
                                  data.tracesReceived.push(trace);
                              });
                            }

                            callback(err);
                          });
      }
    ],
    function(err)
    {
      callback(err);
    });
  }
  function getMoreTransactions(callback, minBlocks)
  {
    data.numberOfTransactions = data.tracesSent.length + data.tracesReceived.length;
    //console.log("numberOfTransactions found so far: " + data.numberOfTransactions);

    if (data.numberOfTransactions < targetNumberOfTransactions && data.fromBlock > 0)
    {
      var toBlock = data.fromBlock - 1;
      var numberToProcess = 0;
      if (data.numberOfTransactions > 0)
      {
        var processedBlocks = data.lastBlock - data.fromBlock + 1;
        var numberOfTransactionsLeft = targetNumberOfTransactions - data.numberOfTransactions;
        numberOfTransactionsLeft /= 4;  // Start with approximating for 25% more transactions to target.
        numberToProcess = Math.floor(processedBlocks * numberOfTransactionsLeft / data.numberOfTransactions);
        if (numberToProcess < minBlocks)
          numberToProcess = minBlocks;
      }
      else
      {
        if (minBlocks > kInitialMaxBlocks)
        {
          numberToProcess = kMaxBlocksToProcess;
        }
        else
        {
          numberToProcess = minBlocks;
        }
      }
      //console.log("numberToProcess: " + numberToProcess);

      if (numberToProcess > kMaxBlocksToProcess)
        numberToProcess = kMaxBlocksToProcess;

      var fromBlock = data.fromBlock - numberToProcess;
      if (fromBlock < 0)
        fromBlock = Math.floor(data.fromBlock / 2);

      data.fromBlock = fromBlock;

      //console.log("From: 0x" + data.fromBlock.toString(16) + " (" + data.fromBlock + ")");
      //console.log("To:   0x" + toBlock.toString(16) + " (" + toBlock + ")");

      getTransactions(toBlock, callback);
    }
    else
    {
      callback(null);
    }
  }
  
  async.waterfall([
    function(callback)
    {
      try
      {
        web3.eth.getBlock("latest", false, function(err, result) { callback(err, result.number); });
      }
      catch(error)
      {
        console.log(error);
        callback(error, 0);
      }
    },
    function(lastBlockNumber, callback)
    {
      data.lastBlock = lastBlockNumber;

      if(data.lastBlock > kInitialMaxBlocks)
      {
        data.fromBlock = data.lastBlock - kInitialMaxBlocks;
      }
      else
      {
        data.fromBlock = 0;
      }

      try
      {
        web3.eth.getBalance(accountLowercase, function(err, balance) { callback(err, balance); });
      }
      catch(error)
      {
        console.log(error);
        callback(error, 0);
      }
    },
    function(balance, callback)
    {
      data.balance = balance;
      try
      {
        web3.eth.getCode(accountLowercase, function(err, code) { callback(err, code); });
      }
      catch(error)
      {
        console.log(error);
        callback(error, "");
      }
    },
    function(code, callback)
    {
      data.code = code;
      if (code !== "0x")
      {
        data.isContract = true;
      }

      db.get(accountLowercase, function(err, value) { callback(null, value); });
    },
    function(source, callback)
    {
      // Disable this for now.
      if (false)//(source)
      {
        data.source = JSON.parse(source);
        
        var abi = JSON.parse(data.source.abi);
        var contract = web3.eth.contract(abi).at(accountLowercase);
        
        data.contractState = [];
        
        async.eachSeries(abi, function(item, eachCallback)
        {
          if (item.type === "function" && item.inputs.length === 0 && item.constant)
          {
            try
            {
              contract[item.name](function(err, result)
                                  {
                                    data.contractState.push({ name: item.name, result: result });
                                    eachCallback();
                                  });
            }
            catch(e)
            {
              console.log(e);
              eachCallback();
            }
          }
          else
          {
            eachCallback();
          }
        },
        function(err) { callback(err); });
      }
      else
      {
        callback();
      }
    },
    function(callback)
    {
      T1 = Date.now();
      console.log("T1: %d, %f secs.", T1, (T1-T0) * 1e-3);

      console.log("From: 0x" + data.fromBlock.toString(16) + " (" + data.fromBlock + ")");
      console.log("To:   0x" + data.lastBlock.toString(16) + " (" + data.lastBlock + ")");

      data.tracesSent = [];
      data.tracesReceived = [];

      getTransactions(data.lastBlock, callback);
    },
    function(callback)
    {
      T2 = Date.now();
      console.log("T2: %d, %f secs.", T2, (T2-T1) * 1e-3);

      var callbacks = [];
      callbacks.push(function(callback) { getMoreTransactions(callback, kInitialMaxBlocks); });
      for (i = 1; i < kMaxIterations; i++)
        callbacks.push(function(callback) { getMoreTransactions(callback, kMinBlocksToProcess); });

      async.series(callbacks, function(err) { callback(err); });
    },
    function(callback)
    {
      T3 = Date.now();
      console.log("T3: %d, %f secs.", T3, (T3-T2) * 1e-3);

      data.address = accountLowercase;
      data.numberOfTransactions = data.tracesSent.length + data.tracesReceived.length;
      data.numberOfBlocksMined = 0;
      data.numberOfUncles = 0;
      console.log("Number of transactions = %d, from block %d",
                  data.numberOfTransactions, data.fromBlock);
      
      var numberOfBlocks = 0;
      var blocks = {};
      data.tracesSent.forEach(function(trace)
      {
        if (!blocks[trace.blockNumber])
        {
          blocks[trace.blockNumber] = [];
          numberOfBlocks++;
        }
        blocks[trace.blockNumber].push(trace);
      });
  
      console.log("data.tracesReceived.length = %d", data.tracesReceived.length);

      data.tracesReceived.forEach(function(trace)
      {
        if (!blocks[trace.blockNumber])
        {
          blocks[trace.blockNumber] = [];
          numberOfBlocks++;
        }
        blocks[trace.blockNumber].push(trace);
        
        if (trace.type == "reward")
        {
          data.numberOfBlocksMined++;

          if (trace.action.rewardType == "uncle")
            data.numberOfUncles++;
        }
      });
      
      data.blockCount = numberOfBlocks;
      console.log("data.blockCount = %d", data.blockCount);
      console.log("Blocks mined: %d, Uncles: %d",
                  data.numberOfBlocksMined, data.numberOfUncles);

      T4 = Date.now();
      console.log("T4: %d, %f secs.", T4, (T4-T3) * 1e-3);

      if (data.blockCount > 0)
      {
        var count = 0;
        var blockList = [];
        for (var block in blocks)
          blockList.push(block);
        
        blockList.forEach
        (function(block)
         {
           web3.eth.getBalance(data.address, block, 
                               function(err, result)
                               {
                                 blocks[block].balance = result;

                                 web3.eth.getBlock(block, false,
                                                   function(err, result)
                                                   {
                                                     blocks[result.number].time = result.timestamp;
                                                     blocks[result.number].difficulty = result.difficulty;

                                                     count++;
                                                     if (count >= data.blockCount)
                                                     {
                                                       callback(err, blocks);
                                                     }
                                                   });
                               });
         });
      }
      else
      {
        callback(null, blocks);
      }
    }
  ],

  function(err, blocks)
  {
    T5 = Date.now();
    console.log("T5: %d, %f secs.", T5, (T5-T4) * 1e-3);

    if (err)
    {
      return next(err);
    }
  
    data.tracesSent = null;
    data.tracesReceived = null;
    
    data.blocks = [];
    for (var block in blocks)
      data.blocks.push(blocks[block]);
    
    if (data.source)
    {
      data.name = data.source.name;
    }
    else if (config.names[data.address])
    {
      data.name = config.names[data.address];
    }

    data.blocks = data.blocks.reverse().splice(0, 5*targetNumberOfTransactions);

    T6 = Date.now();
    console.log("T6: %d, %f secs.", T6, (T6-T5) * 1e-3);

    res.render('account', { account: data });

    T7 = Date.now();
    console.log("T7: %d, %f secs.", T7, (T7-T6) * 1e-3);

    var TE = Date.now();
    console.log("TE: %d, %f secs.", TE, (TE-T0) * 1e-3);
    console.log("-----------------------------------------------------------------")
  });
  
}

router.get('/:account', GetAccountInfo);
router.get('/:account/:targetNumberOfTransactions', GetAccountInfo);

module.exports = router;
