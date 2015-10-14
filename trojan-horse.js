/*!

Copyright (C) 2015 by Andrea Giammarchi - @WebReflection

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

// server side nodejs module
var vm = require('vm');
var crypto = require('crypto');
var qs = require('querystring');

var $200 = {'Content-Type': 'application/json'};

var cache = Object.create(null);
var i = 0;

var nonces;

function createNonce(fn) {
  return crypto
    .createHash('sha256')
    .update(normalize(fn))
    .digest('hex');
}

function createSandbox() {
  var sandBox = {
    process: {
      title: process.title,
      version: process.version,
      moduleLoadList: process.moduleLoadList,
      versions: process.versions,
      arch: process.arch,
      platform: process.platform,
      hrtime: process.hrtime,
      uptime: process.uptime,
      memoryUsage: process.memoryUsage,
      binding: process.binding,
      nextTick: process.nextTick
    },
    Buffer: Buffer,
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval,
    setImmediate: setImmediate,
    clearImmediate: clearImmediate,
    console: console,
    module: module,
    require: require
  };
  return (sandBox.global = sandBox);
}

function error(response, num, content) {
  var msg = '';
  switch (num) {
    case 403: msg = 'Forbidden'; break;
    case 413: msg = 'Request entity too large'; break;
    case 417: msg = 'Expectation Failed'; break;
    case 500: msg = 'Internal Server Error'; break;
  }
  response.writeHead(num, msg, {'Content-Type': 'text/plain'});
  response.end(content || msg);
}

function normalize(fn) {
  return ''.replace
      .call(fn, /\/\/[^\n\r]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '');
}

function trojanHorse(request, response, next) {
  var uid, data, resolve, reject;
  if (~request.url.indexOf('/.trojan-horse')) {
    if (request.url === '/.trojan-horse.js') {
      response.writeHead(200, 'OK', {'Content-Type': 'application/javascript'});
      response.end('' + TrojanHorse);
      return true;
    } else if (
      request.url === '/.trojan-horse' &&
      request.method === 'POST' &&
      ('x-trojan-horse' in request.headers)
    ) {
      data = '';
      uid = request.headers['x-trojan-horse'];
      request.on('data', function (chunk) {
        data += chunk;
        if (data.length > 1e7) {
          error(response, 413);
          request.connection.destroy();
        }
      });
      request.on('end', function() {
        var sb, info = qs.parse(data);
        if (info.action === 'drop') {
          if (!uid) return error(response, 403);
          delete cache[uid];
          response.writeHead(200, 'OK', $200);
          response.end('true');
        }
        else if (info.action === 'create') {
          if (uid) return error(response, 403);
          crypto.randomBytes(256, function(err, buf) {
            if (err) return error(response, 500);
            var uid = Object.keys(cache).length + ':' +
                      crypto.createHash('sha1').update(buf).digest('hex');
            cache[uid] = Object.defineProperty(
              vm.createContext(createSandbox()),
              '__TH__',
              {value: Object.create(null)}
            );
            response.writeHead(200, 'OK', $200);
            response.end(JSON.stringify(uid));
          });
        }
        else {
          if (nonces && nonces.length && nonces.every(
              function (fn) { return this != fn.replace(/^.*?:/, ''); },
              createNonce(info.fn).replace(/^.*?:/, '')
            )
          ) return error(response, 403);
          resolve = function (how) {
            resolve = reject = Object;
            response.writeHead(200, 'OK', $200);
            response.end(JSON.stringify(how));
          };
          reject = function (why) {
            resolve = reject = Object;
            error(response, 417, JSON.stringify(
              $200.toString.call(why).slice(-6) === 'Error]' ?
                why.message : why
            ));
          };
          if (uid in cache) {
            sb = cache[uid];
            sb.__TH__[++i] = [resolve, reject];
            vm.runInContext(
              '(function(){' +
              'var resolve = function(){var r=__TH__[' + i + '];if(r){delete __TH__[' + i + '];r[0].apply(this,arguments)}};' +
              'var reject = function(){var r=__TH__[' + i + '];if(r){delete __TH__[' + i + '];r[1].apply(this,arguments)}};' +
              '(' + info.fn + '.apply(null,' + info.args + '));' +
              '}.call(null));',
              sb
            );
          } else {
            sb = createSandbox();
            sb.resolve = resolve;
            sb.reject = reject;
            vm.runInNewContext('(' + info.fn + '.apply(null,' + info.args + '))', sb);
          }
        }
      });
      return true;
    }
  }
  if (next) next();
  return false;
}


Object.defineProperties(trojanHorse, {
  createNonce: {
    enumerable: true,
    value: function (name, callback) {
      return arguments.length === 2 ?
        [name, createNonce(callback)].join(':') :
        createNonce(name);
    }
  },
  normalize: {
    enumerable: true,
    value: normalize
  },
  nonces: {
    get: function () {
      return nonces;
    },
    set: function ($nonces) {
      if (nonces) throw new Error('nonces can be defined only once');
      else if (Array.isArray($nonces)) nonces = [].concat($nonces);
      else throw new Error('nonces must be an Array');
    }
  }
});

module.exports = trojanHorse;

// --------------------------------------------
// client side JS served via /.trojan-horse.js
// !!! it might require a Promise polyfill !!!
// --------------------------------------------
function TrojanHorse(credentials) {'use strict';
  if (!(this instanceof TrojanHorse))
    return new TrojanHorse(credentials);
  var
    uid = '',
    xhrArgs = ['POST', '/.trojan-horse', true].concat(
      credentials ? [credentials.user, credentials.pass] : []
    ),
    createXHR = function (data) {
      var xhr = new XMLHttpRequest;
      xhr.open.apply(xhr, xhrArgs);
      xhr.setRequestHeader('X-Trojan-Horse', uid);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.send(data);
      return xhr;
    },
    parse = function (xhr) {
      return JSON.parse(xhr.responseText);
    }
  ;
  this.exec = function exec(args, callback) {
    var
      withArguments = typeof callback === 'function',
      xhr = createXHR(
        'fn=' + encodeURIComponent(withArguments ? callback : args) +
        '&args=' + encodeURIComponent(JSON.stringify(
          withArguments ? [].concat(args) : []
        ))
      )
    ;
    return new Promise(function (resolve, reject) {
      xhr.onerror = function () { reject('Network Error'); };
      xhr.onload = function () {
        if (xhr.status == 200) resolve(parse(xhr));
        else reject(xhr.statusText || xhr.responseText);
      };
    });
  };
  this.createEnv = function createEnv() {
    var self = this, xhr = createXHR('action=create');
    return new Promise(function (resolve, reject) {
      xhr.onerror = function () { reject('Network Error'); };
      xhr.onload = function () {
        if (xhr.status == 200) {
          uid = parse(xhr);
          resolve(self);
        }
        else reject(xhr.statusText || xhr.responseText);
      };
    });
  };
  this.dropEnv = function dropEnv() {
    createXHR('action=drop');
    uid = '';
    return Promise.resolve(this);
  };
}