/* eslint-disable no-whitespace-before-property */

process.on ( 'uncaughtException', function ( err ) {
    console.log ( err );
    process.exit ( 1 );
});

import * as env                     from 'env';
import Discord                      from 'discord.js';

const client = new Discord.Client ();

client.on ( 'ready', () => {
    console.log ( `Logged in as ${ client.user.tag }!` );
});

client.on ( 'message', msg => {

    if ( msg.author.bot ) return;

    if ( msg.content === 'ping' ) {
        msg.reply ( 'pong' );
    }
});

// last known nonce
// prepare transaction
// note transaction height
// keep sending transaction after acceptance for ~N blocks
// if nonce rewinds, remake transactions
// get list of pending transactions

// need: primary node
// need: account key
// need: account name
// need: generate account noise

client.login ( env.BOT_TOKEN );
