const knex = appRequire('init/knex').knex;
const serverPlugin = appRequire('plugins/flowSaver/server');
const accountPlugin = appRequire('plugins/account/index');
const dns = require('dns');
const net = require('net');

const loginLog = {};
const scanLoginLog = ip => {
  for(let i in loginLog) {
    if(Date.now() - loginLog[i].time >= 10 * 60 * 1000) {
      delete loginLog[i];
    }
  }
  if(!loginLog[ip]) {
    return false;
  } else if (loginLog[ip].number <= 5) {
    return false;
  } else {
    return true;
  }
};
const loginFail = ip => {
  if(!loginLog[ip]) {
    loginLog[ip] = { number: 1, time: Date.now() };
  } else {
    loginLog[ip] = { number: loginLog[ip].number + 1, time: Date.now() };
  }
};

const getIp = address => {
  if(net.isIP(address)) {
    return Promise.resolve(address);
  }
  return new Promise((resolve, reject) => {
    dns.lookup(address, (err, address, family) => {
      if(err) {
        return reject(err);
      }
      return resolve(address);
    });
  });
};

const newAccount = (mac, userId, serverId, accountId) => {
  return knex('mac_account').insert({
    mac, userId, serverId, accountId,
  });
};

const getAccount = async userId => {
  const accounts = await knex('mac_account').where({
    'mac_account.userId': userId,
  });
  return accounts;
};

const getAccountForUser = async (mac, ip) => {
  if(scanLoginLog(ip)) {
    return Promise.reject('ip is in black list');
  }
  const macAccount = await knex('mac_account').where({ mac }).then(success => success[0]);
  if(!macAccount) {
    loginFail(ip);
    return Promise.reject('mac account not found');
  }
  const myServerId = macAccount.serverId;
  const myAccountId = macAccount.accountId;
  const accounts = await knex('mac_account').select([
    'mac_account.id',
    'mac_account.mac',
    'account_plugin.id as accountId',
    'account_plugin.port',
    'account_plugin.password',
  ])
  .leftJoin('user', 'mac_account.userId', 'user.id')
  .leftJoin('account_plugin', 'mac_account.userId', 'account_plugin.userId');
  const account = accounts.filter(a => {
    return a.accountId === myAccountId;
  })[0];
  const servers = await serverPlugin.list();
  const server = servers.filter(s => {
    return s.id === myServerId;
  })[0];
  const address = await getIp(server.host);
  const validServers = JSON.parse((await accountPlugin.getAccount({ id: myAccountId }))[0].server);
  const serverList = servers.filter(f => {
    if(!validServers) {
      return true;
    } else {
      return validServers.indexOf(f.id) >= 0;
    }
  }).map(f => {
    return getIp(f.host).then(success => {
      return {
        name: f.name,
        address: success,
      };
    });
  });
  const serverReturn = await Promise.all(serverList);
  return {
    default: {
      address,
      port: account.port,
      password: account.password,
      method: server.method,
    },
    servers: serverReturn,
  };
};

const editAccount = (id, mac, serverId, accountId) => {
  return knex('mac_account').update({
    mac, serverId, accountId,
  }).where({ id });
};

const deleteAccount = id => {
  return knex('mac_account').delete().where({ id });
};

const login = async (mac, ip) => {
  if(scanLoginLog(ip)) {
    return Promise.reject('ip is in black list');
  }
  const account = await knex('mac_account').where({ mac }).then(success => success[0]);
  if(!account) {
    loginFail(ip);
    return Promise.reject('mac account not found');
  } else {
    return account;
  }
};

exports.editAccount = editAccount;
exports.newAccount = newAccount;
exports.getAccount = getAccount;
exports.deleteAccount = deleteAccount;
exports.getAccountForUser = getAccountForUser;
exports.login = login;