const { join } = require('path');
const bttps = require(join(__dirname, 'bttps.js'));
const fallbackListData = require('./fallbackListData.json');

let listData;
let extendedLogging = false;

/**
 * @param {Object} apiKeys A JSON object formatted like: {"botlist name":"API Keys for that list", etc.} ; it also includes other metadata including sharddata
 */
const postToAllLists = async apiKeys => {
  // make sure we have all lists we can post to and their apis
  if (!listData) {
    listData = await bttps.get('https://botblock.org/api/lists').catch(e => console.error(`BLAPI: ${e}`));
    if (!listData) {
      console.error("BLAPI : Something went wrong when contacting BotBlock for the API of the lists, so we're using an older preset. Some lists might not be available because of this.");
      listData = fallbackListData;
    }
  }
  for (const listname in listData) {
    if (apiKeys[listname] && (listData[listname]['api_post'] || listname === 'discordbots.org')) { // we even need to check this extra because botblock gives us nulls back
      let list = listData[listname];
      if (listname === 'discordbots.org') {
        list = fallbackListData[listname];
      }
      const url = `https://${listname}`;
      const apiPath = list['api_post'].replace(url, '').replace(':id', apiKeys.bot_id);
      // creating JSON object to send, reading out shard data
      let sendObjString = `{ "${list['api_field']}": ${apiKeys.server_count}`;
      if (apiKeys.shard_id && list['api_shard_id']) {
        sendObjString += `, "${list['api_shard_id']}": ${apiKeys.shard_id}`;
      }
      if (apiKeys.shard_count && list['api_shard_count']) {
        sendObjString += `, "${list['api_shard_count']}": ${apiKeys.shard_count}`;
      }
      if (apiKeys.shards && list['api_shards']) {
        sendObjString += `, "${list['api_shards']}": ${apiKeys.shards}`;
      }
      sendObjString += ' }';
      const sendObj = JSON.parse(sendObjString);
      bttps.post(listname, apiPath, apiKeys[listname], sendObj, extendedLogging).catch(e => console.error(`BLAPI: ${e}`));
    }
  }
};

/**
 * @param {Client} client Discord.js client
 * @param {Object} apiKeys A JSON object formatted like: {"botlist name":"API Keys for that list", etc.}
 * @param {number} repeatInterval Number of minutes between each repetition
 */
const handleInternal = async (client, apiKeys, repeatInterval) => {
  // set the function to repeat
  setTimeout(handleInternal.bind(null, client, apiKeys, repeatInterval), 60000 * repeatInterval);

  // the actual code to post the stats
  if (client.user) {
    // Checks if bot is sharded
    /* eslint-disable camelcase */
    apiKeys.bot_id = client.user.id;
    // Checks if bot is sharded
    if (client.shard) {
      if (client.shard.id === 0) {
        apiKeys.shard_count = client.shard.count;

        // This will get as much info as it can, without erroring
        const shardCounts = await client.shard.broadcastEval('this.guilds.size').catch(e => console.error('BLAPI: Error while fetching shard server counts:', e));
        if (shardCounts.length !== client.shard.count) {
          // If not all shards are up yet, we skip this run of handleInternal
          return;
        }

        apiKeys.shards = shardCounts;
        apiKeys.server_count = apiKeys.shards.reduce((prev, val) => prev + val, 0);
      }
      // Checks bot is sharded (internal sharding)
    } else if (client.ws.shards) {
      apiKeys.shard_count = client.ws.shards.length;

      // Get array of shards
      const shardCounts = [];
      client.ws.shards.forEach(shard => {
        let count = 0;
        client.guilds.forEach(g => {
          if (g.shardID === shard.id) count++;
        });
        shardCounts.push(count);
      });
      if (shardCounts.length !== client.ws.shards.length) {
        // If not all shards are up yet, we skip this run of handleInternal
        return;
      }

      apiKeys.shards = shardCounts;
      apiKeys.server_count = client.guilds.size;
    } else {
      apiKeys['server_count'] = client.guilds.size;
    }
    /* eslint-enable camelcase */
    if (repeatInterval > 2) { // if the interval isnt below the BotBlock ratelimit, use their API
      bttps
        .post('botblock.org', '/api/count', 'no key needed for this', apiKeys)
        .catch(error => console.error('BLAPI:', error));

      // they blacklisted botblock, so we need to do this, posting their stats manually
      if (apiKeys['discordbots.org']) {
        let newApiKeys;
        /* eslint-disable camelcase */
        newApiKeys.bot_id = apiKeys.bot_id;
        newApiKeys['discordbots.org'] = apiKeys['discordbots.org'];
        newApiKeys.shard_id = apiKeys.shard_id;
        newApiKeys.shard_count = apiKeys.shard_count;
        newApiKeys.shards = apiKeys.shards;
        newApiKeys.server_count = apiKeys.server_count;
        /* eslint-enable camelcase */
        postToAllLists(newApiKeys);
      }
    } else {
      postToAllLists(apiKeys);
    }
  } else {
    console.error("BLAPI : Discord client seems to not be connected yet, so we're skipping the post");
  }
};

module.exports = {
  /**
   * This function is for automated use with discord.js
   * @param {Client} discordClient Client via wich your code is connected to Discord
   * @param {Object} apiKeys A JSON object formatted like: {"botlist name":"API Keys for that list", etc.}
   * @param {integer} repeatInterval Number of minutes until you want to post again, leave out to use 30
   */
  handle: (discordClient, apiKeys, repeatInterval) => {
    // handle inputs
    if (!repeatInterval || repeatInterval < 1) repeatInterval = 30;
    handleInternal(discordClient, apiKeys, repeatInterval);
  },
  /**
   * For when you don't use discord.js or just want to post to manual times
   * @param {integer} guildCount Integer value of guilds your bot is serving
   * @param {string} botID Snowflake of the ID the user your bot is using
   * @param {Object} apiKeys A JSON object formatted like: {"botlist name":"API Keys for that list", etc.}
   * @param {boolean} noBotBlockPlis If you don't want to use the BotBlock API add this as True
   */
  manualPost: (guildCount, botID, apiKeys, noBotBlockPlis) => {
    /* eslint-disable camelcase */
    apiKeys.server_count = guildCount;
    apiKeys.bot_id = botID;
    /* eslint-enable camelcase */
    if (noBotBlockPlis) {
      postToAllLists(apiKeys);
    } else {
      bttps.post('botblock.org', '/api/count', 'no key needed for this', apiKeys, extendedLogging).catch(e => console.error(`BLAPI: ${e}`));
    }
  },
  /**
   * For when you don't use discord.js or just want to post to manual times
   * @param {integer} guildCount Integer value of guilds your bot is serving
   * @param {string} botID Snowflake of the ID the user your bot is using
   * @param {Object} apiKeys A JSON object formatted like: {"botlist name":"API Keys for that list", etc.}
   * @param {integer} shardID The shard ID, which will be used to identify the shards valid for posting (and for super efficient posting with BLAPIs own distributer when not using botBlock)
   * @param {integer} shardCount The number of shards the bot has, which is posted to the lists
   * @param {[integer]} shards An array of guild counts of each single shard (this should be a complete list, and only a single shard will post it)
   * @param {boolean} noBotBlockPlis If you don't want to use the BotBlock API add this as True
   */
  manualPostSharded: (guildCount, botID, apiKeys, shardID, shardCount, shards, noBotBlockPlis) => { // TODO complete
    if (shardID === 0 || !shards) { // if we don't have all the shard info in one place well try to post every shard itself
      /* eslint-disable camelcase */
      apiKeys.bot_id = botID;
      apiKeys.shard_id = shardID;
      apiKeys.shard_count = shardCount;
      if (shards) {
        apiKeys.shards = shards;
        apiKeys.server_count = apiKeys.shards.reduce((prev, val) => prev + val, 0);
      } else {
        apiKeys.server_count = guildCount;
      }
      /* eslint-enable camelcase */
      if (noBotBlockPlis) {
        postToAllLists(apiKeys);
      } else {
        bttps.post('botblock.org', '/api/count', 'no key needed for this', apiKeys, extendedLogging).catch(e => console.error(`BLAPI: ${e}`));
      }
    }
  },
  setLogging: setLogging => {
    extendedLogging = setLogging;
  }
};
