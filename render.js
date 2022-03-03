var { Image, createCanvas } = require('canvas');
var { exec } = require('child_process');
var fs = require('fs');
var https = require('https');
var Web3 = require('web3');

var {
  WEB3_PROVIDER,
  CONTRACT_ADDRESS_VIBES,
  CONTRACT_ADDRESS_OPEN_VIBES,
  ABI_VIBES,
  ABI_OPEN_VIBES
} = require('./contracts');

var DELAY_TIME = 60 * 1000;
var RENDER_SIZE = 1200;
var USE_DOWNSAMPLE = true;
var SKIP_OPEN_VIBES = true;

var web3 = new Web3(
  new Web3.providers.WebsocketProvider(WEB3_PROVIDER)
);

var VibesContract = new web3.eth.Contract(ABI_VIBES, CONTRACT_ADDRESS_VIBES);
var OpenVibesContract = new web3.eth.Contract(ABI_OPEN_VIBES, CONTRACT_ADDRESS_OPEN_VIBES);

var startTime = Date.now();
var localStartTime = Date.now();
var remoteCount = 0;
var completeRenders = [];
var vibesSupply = 0;
var openVibesSupply = 0;
var vibesEndId = 0;
var openVibesEndId = 7777;

function start () {
  startTime = Date.now();
  localStartTime = Date.now();
  remoteCount = 0;

  fetchSupplies()
    .then(() => updateCompleteRenders())
    .then(() => startRemoteRenders())
    .then(() => fetchRemoteRenders())
    .then(() => updateCompleteRenders())
    .then(() => startLocalRenders())
    .then(() => finish());
};

function fetchSupplies () {
  console.log("\n~ fetching supplies ...");

  return VibesContract.methods.totalSupply().call()
    .then(supply => vibesSupply = +supply || 0)
    .then(() => OpenVibesContract.methods.totalSupply().call())
    .then(supply => openVibesSupply = +supply || 0)
    .then(() => {
      vibesEndId = vibesSupply;
      openVibesEndId = 7777 + openVibesSupply;

      console.log(`~~~ [genesis] vibes: ${vibesSupply} (1 - ${vibesEndId})`);
      console.log(`~~~ [open] vibes: ${openVibesSupply} (7778 - ${openVibesEndId})`);
    });
};

function updateCompleteRenders () {
  console.log("\n~ updating complete renders ...");

  completeRenders = [];

  var remoteImages = fs.readdirSync("./output_remote");
  remoteImages.forEach((image, i) => {
    var id = +image.replace('.jpg', '');
    if (!isNaN(id)) {
      completeRenders.push(id);
    }
  });

  var localImages = fs.readdirSync("./output_local");
  localImages.forEach((image, i) => {
    var id = +image.replace('.jpg', '');
    if (!isNaN(id) && completeRenders.indexOf(id) === -1) {
      completeRenders.push(id);
    }
  });

  var finalImages = fs.readdirSync("./output_final");
  finalImages.forEach((image, i) => {
    var id = +image.replace('.jpg', '');
    if (!isNaN(id) && completeRenders.indexOf(id) === -1) {
      completeRenders.push(id);
    }
  });
};

function startRemoteRenders () {
  console.log("\n~ starting remote renders ...");

  for (var i = 1; i <= vibesEndId; i++) {
    if (completeRenders.indexOf(i) >= 0) {
      continue;
    }

    startRemoteRender(i);

    if (remoteCount >= 50) {
      vibesEndId = i;
      break;
    }
  }

  if (!SKIP_OPEN_VIBES) {
    for (var j = 7778; j <= openVibesEndId; j++) {
      if (completeRenders.indexOf(j) >= 0) {
        continue;
      }

      startRemoteRender(j);

      if (remoteCount >= 50) {
        openVibesEndId = j;
        break;
      }
    }
  }

  var remoteDelay = new Promise((resolve) => {
    var delay = 16 * DELAY_TIME;
    if (remoteCount === 0) {
      delay = 0;
      console.log("\n~ all caught up!");
    } else {
      console.log("\n~ waiting 16 minutes for remote renders ...");
    }

    setTimeout(() => resolve(), delay);
  });

  return remoteDelay;
};

function startRemoteRender (tokenId) {
  console.log(`~~~ remote render ${tokenId}`);

  setTimeout(() => {
    requestRemoteRender(tokenId);
    fetchScript(tokenId);
  }, 250 * remoteCount);

  remoteCount++;
};

function requestRemoteRender (tokenId) {
  var data = `{ "tokenId": ${tokenId}, "renderSize": ${RENDER_SIZE}, "useDownsample": ${USE_DOWNSAMPLE} }`;
  var options = {
    hostname: '< insert your AWS host >',
    port: 443,
    path: '/test/render',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  var req = https.request(options, res => res.on('data', d => process.stdout.write(d)));
  req.on('error', error => console.error(error));
  req.write(data);
  req.end();
};

function fetchScript (tokenId) {
  var contract = VibesContract;
  if (tokenId > 7777) {
    contract = OpenVibesContract;
  }

  contract.methods.tokenScript(tokenId).call()
    .then((tokenScript) => saveScript(tokenId, tokenScript));
};

function saveScript (tokenId, tokenScript) {
  fs.writeFile(`./output_local/${tokenId}.html`, tokenScript, function (err) {
    if (err) {
      console.log(tokenId, err);
    }
  });
};

function fetchRemoteRenders () {
  console.log(`\n~ fetching remote renders ...`);

  exec('sh ./syncRemote.sh', (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log(`exec error: ${error}`);
    }
  });

  var syncDelay = new Promise((resolve) => {
    var delay = DELAY_TIME;
    if (remoteCount === 0) {
      delay = 0;
    } else {
      console.log("\n~ waiting a minute for remote sync ...");
    }

    setTimeout(() => resolve(), delay);
  });

  return syncDelay;
};

function startLocalRenders () {
  console.log("\n~ starting local renders ...");

  return new Promise((resolve) => startLocalRender(1, vibesEndId, resolve))
    .then(() => new Promise((resolve) => {
      if (!SKIP_OPEN_VIBES) {
        startLocalRender(7778, openVibesEndId, resolve);
      } else {
        resolve();
      }
    }));
};

function startLocalRender (tokenId, endId, finalCallback) {
  var contract = VibesContract;
  if (tokenId > 7777) {
    contract = OpenVibesContract;
  }

  var renderNext = function () {
    if (tokenId !== endId) {
      startLocalRender(tokenId + 1, endId, finalCallback);
    } else {
      finalCallback();
    }
  };

  if (completeRenders.indexOf(tokenId) >= 0) {
    return renderNext();
  }

  contract.methods.tokenScript(tokenId).call()
    .then((tokenScript) => {
      saveScript(tokenId, tokenScript);

      localStartTime = Date.now();
      console.log(`~~~ local rendering ${tokenId} ...`);
      var window = {
        innerWidth: RENDER_SIZE,
        innerHeight: RENDER_SIZE,
        addEventListener: function () {},
        removeEventListener: function () {},
        UDS: USE_DOWNSAMPLE,
        FVCS: RENDER_SIZE,
        RNCB: function (imgCanvas) {
          console.log(`~~~ saving image ${tokenId} ...`);
          saveImage(tokenId, imgCanvas, renderNext);
        }
      };

      var document = {
        body: {
          clientWidth: RENDER_SIZE,
          clientHeight: RENDER_SIZE,
          appendChild: function () {}
        },
        createElement: function (name) {
          if (name === "canvas") {
            var retCanvas = createCanvas(RENDER_SIZE, RENDER_SIZE);
            retCanvas.style = {};
            return retCanvas;
          } else {
            return {
              style: {},
              addEventListener: function () {}
            };
          }
        }
      };

      tokenScript = tokenScript.replace('<!doctype html><html><head><script>', '');
      tokenScript = tokenScript.replace('</script></head><body></body></html>', '');
      tokenScript = tokenScript.replace(
        'c.addEventListener("load",function(){dPc=.6,uLP(),b(rdI(c,vCS,vCS))})',
        'c.onload=function(){dPc=.6,uLP(),b(rdI(c,vCS,vCS))}'
      );

      eval(tokenScript);
      window.onload();
    });
};

function saveImage (tokenId, imgCanvas, cb) {
  var out = fs.createWriteStream(`./output_local/${tokenId}.jpg`);
  var stream = imgCanvas.createPNGStream();
  stream.pipe(out);
  out.on('finish', () => {
    var elapsed = (Date.now() - localStartTime) / 1000;
    elapsed = Math.floor(elapsed) / 60;
    console.log(`~~~ elapsed ${tokenId}: ${elapsed}`);
    cb();
  });
};

function finish () {
  if (remoteCount === 0) {
    return process.exit();
  }

  console.log(`\n~ copying files ...`);

  var child = exec('sh ./copyFiles.sh', (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log(`exec error: ${error}`);
    }
  });

  child.on('exit', () => {
    console.log(`\n~ finished!`);

    var elapsed = (Date.now() - startTime) / 1000;
    elapsed = Math.floor(elapsed) / 60;
    console.log(`~~~ total elapsed: ${elapsed}`);

    loopOrEnd();
  });
};

function loopOrEnd () {
  if (remoteCount >= 50) {
    console.log(`\n~ starting next batch!`);
    start();
  } else {
    process.exit();
  }
};

start();
