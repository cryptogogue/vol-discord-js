/* eslint-disable no-whitespace-before-property */

process.on ( 'uncaughtException', function ( err ) {
    console.log ( err );
    process.exit ( 1 );
});

import sqlite3                      from 'better-sqlite3';
import * as config                  from 'config';
import Discord                      from 'discord.js';
import * as env                     from 'env';
import { assert, crypto, util }     from 'fgc';
import fs                           from 'fs';
import fetch                        from 'cross-fetch';
import url                          from 'url';
import * as vol                     from 'vol';
import _                            from 'lodash';

// https://discord.js.org/#/

const BOT_PREFIX                = config.BOT_PREFIX;
const BOT_COMMANDS              = config.BOT_COMMANDS;
const COMMAND_RESTRICTIONS      = config.COMMAND_RESTRICTIONS;
const SERVICE_INTERVAL          = config.SERVICE_INTERVAL;
const SQLITE_FILE               = config.SQLITE_FILE;
const VOL_NETWORK               = config.VOL_NETWORK;

const TRANSACTION_STATUS = {
    NEW:                'NEW',PENDINGACCEPTED:           'ACCEPTED',
    REJECTED:           'REJECTED',
    INCOMPLETE:         'INCOMPLETE',
}

const TRANSACTION_TYPE = {
    OPEN_ACCOUNT:       'OPEN_ACCOUNT',
    REGISTER_MINER:     'REGISTER_MINER',
}

const VOL_MAKER = {
    gratuity:           0,
    profitShare:        0,
    transferTax:        0,
    accountName:        false,
    keyName:            'master',
    nonce:              -1,
};

const HELP_TEXT = `
    ${ BOT_PREFIX } ${ BOT_COMMANDS.ACCOUNT } <account request> - paste an account request from your wallet to provision a new account.
    ${ BOT_PREFIX } ${ BOT_COMMANDS.CONSENSUS } - report the current chain height and current miners.
    ${ BOT_PREFIX } ${ BOT_COMMANDS.HELP } - display again this very message.
    ${ BOT_PREFIX } ${ BOT_COMMANDS.INFO } - learn interesting facts about this bot.
    ${ BOT_PREFIX } ${ BOT_COMMANDS.TX } - display the queue of unsent transactions.
    ${ BOT_PREFIX } ${ BOT_COMMANDS.UPGRADE } <node URL> - upgrade the node at this URL to a miner.
`

//----------------------------------------------------------------//
function fetchJSON ( endpoint, init ) {
    return fetch ( endpoint, init ).then ( res => res.json ());
}

//================================================================//
// Volbot
//================================================================//
class Volbot {

    //----------------------------------------------------------------//
    checkExists ( paramString ) {

        const exists = this.db.prepare ( `SELECT id FROM transactions WHERE params IS ?` ).get ( paramString );
        return Boolean ( exists );
    }

    //----------------------------------------------------------------//
    async checkTransactionStatusAsync ( uuid, envelope ) {

        console.log ( 'ENVELOPW', envelope );

        const checkStatus = async ( nodeURL ) => {

            console.log ( 'CHECK STATUS' );

            try {
                const accountURL        = this.consensusService.formatServiceURL ( nodeURL, `/accounts/${ this.accountID }/transactions/${ uuid }`, false, true );
                const result            = await fetchJSON ( accountURL );
                result.url              = accountURL;

                return result;
            }
            catch ( error ) {
                console.log ( error );
            }
            return false;
        }

        const putTransactionAsync = async ( nodeURL ) => {

            console.log ( 'PUT TX' );

            let result = false;

            try {
                result = await fetchJSON ( nodeURL, {
                    method :    'PUT',
                    headers :   { 'content-type': 'application/json' },
                    body :      JSON.stringify ( envelope ),
                });
            }
            catch ( error ) {
                console.log ( 'error or no response' );
                console.log ( error );
            }
            return ( result && ( result.status === 'OK' ));
        }

        const promises = [];
        for ( let nodeURL of this.consensusService.currentURLs ) {
            promises.push ( checkStatus ( nodeURL ));
        }
        const results = await Promise.all ( promises );

        let resultCount     = 0;
        let acceptedCount   = 0;
        let rejectedCount   = 0;
        let message         = false;

        for ( let result of results ) {

            if ( !result ) continue;
            resultCount++;

            console.log ( result );

            switch ( result.status ) {

                case 'ACCEPTED':
                    console.log ( 'ACCEPTED:', result.url );
                    acceptedCount++;
                    break;

                case 'REJECTED':
                    console.log ( 'REJECTED:', result.url );
                    if ( result.uuid !== uuid ) {
                        await putTransactionAsync ( result.url );
                    }
                    else {
                        rejectedCount++;
                        message = message || result.message;
                    }
                    break;

                case 'UNKNOWN':
                    console.log ( 'UNKNOWN:', result.url );
                    await putTransactionAsync ( result.url );
                    break;

                default:
                    break;
            }
        }

        if ( acceptedCount === resultCount  ) return { status: TRANSACTION_STATUS.ACCEPTED };
        if ( rejectedCount === resultCount  ) return { status: TRANSACTION_STATUS.REJECTED, message: message };

        return { status: TRANSACTION_STATUS.NEW };
    }

    //----------------------------------------------------------------//
    async connect ( login ) {

        this.accountID      = VOL_NETWORK.accountID;
        this.genesis        = VOL_NETWORK.genesis;
        this.friendlyName   = VOL_NETWORK.friendlyName;
        this.keyfile        = VOL_NETWORK.keyfile;

        const phraseOrPEM = fs.readFileSync ( this.keyfile, 'utf8' );
        this.key = await crypto.loadKeyAsync ( phraseOrPEM );

        this.db = new sqlite3 ( SQLITE_FILE );

        this.db.prepare (`
            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER         PRIMARY KEY,
                uuid            TEXT            NOT NULL,
                type            TEXT            NOT NULL,
                status          TEXT            NOT NULL DEFAULT 'NEW',
                params          TEXT            NOT NULL,
                channel         TEXT            NOT NULL DEFAULT '',
                mention         TEXT            NOT NULL DEFAULT ''
            )
        `).run ();

        if ( login ) {
            this.client = new Discord.Client ();
            this.client.on ( 'message',     ( message ) => { this.onMessage ( message )});
            this.client.on ( 'ready',       () => { this.onReady ()});
        
            this.client.login ( env.BOT_TOKEN );
        }

        console.log ( 'Starting consensus...' );

        this.consensusService = new vol.ConsensusService ();
        await this.consensusService.initializeWithNodeURLAsync ( VOL_NETWORK.primaryURL );
        await this.consensusService.discoverMinersAsync ();

        console.log ( 'Current miners:', JSON.stringify ( this.consensusService.currentURLs ));

        this.consensusService.startServiceLoopAsync ();
        this.serviceLoop ();
    }

    //----------------------------------------------------------------//
    constructor ( login ) {
        this.connect ( login );
    }

    //----------------------------------------------------------------//
    async findNonceAsync () {

        try {
            const accountURL        = this.consensusService.getServiceURL ( `/accounts/${ this.accountID }` );
            let result              = await fetchJSON ( accountURL );

            return result && result.account && result.account.nonce;
        }
        catch ( error ) {
            console.log ( error );
        }
        return false;
    }

    //----------------------------------------------------------------//
    makeTransaction ( type, params, uuid, nonce ) {

        const body = _.cloneDeep ( params );

        const maker = _.cloneDeep ( VOL_MAKER );
        maker.accountName = this.accountID;

        body.type       = type;
        body.uuid       = uuid;
        body.maker      = maker;

        return vol.util.signTransaction ( this.key, body, nonce );
    }

    //----------------------------------------------------------------//
    async notifyAcceptedAsync ( row ) {

        if ( !( row.channel && row.mention )) return;
        const channel = await this.client.channels.fetch ( row.channel );
        if ( !channel ) return;

        const params = JSON.parse ( row.params );

        switch ( row.type ) {

            case TRANSACTION_TYPE.OPEN_ACCOUNT: {
                const accountName = `.${ this.accountID }.${ params.suffix }`;
                channel.send ( `Fantastic news, <@${ row.mention }>! Your transaction of type ${ row.type } was ACCEPTED! Your new account is named: ${ accountName }` );
                break;
            }

            case TRANSACTION_TYPE.REGISTER_MINER: {
                channel.send ( `Congratulations, <@${ row.mention }>! Your account '${ params.accountName }' is now a miner!` );
                break;
            }
        }
    }

    //----------------------------------------------------------------//
    async notifyRejectedAsync ( row, message ) {

        if ( !( row.channel && row.mention )) return;
        const channel = await this.client.channels.fetch ( row.channel );
        if ( !channel ) return;

        const params = JSON.parse ( row.params );

        const why = message ? `I was sent the following message: '${ message }' Hope that's useful!` : `I wasn't told why. Sorry.`;

        const accountName = `.${ this.accountID }.${ params.suffix }`;
        channel.send ( `Alas, <@${ row.mention }>, your transaction of type ${ row.type } was REJECTED. ${ why }` );
    }

    //----------------------------------------------------------------//
    async onMessage ( message ) {

        if ( message.author.bot ) return;
        if ( !message.content.length ) return;

        const content       = message.content;

        const tokens        = content.split ( ' ' );
        const prefix        = tokens.shift ().toLowerCase ();
        
        if ( prefix != BOT_PREFIX ) return;

        const command       = tokens.shift ().toLowerCase ();
        const restriction   = COMMAND_RESTRICTIONS [ command ];

        if ( restriction && !restriction.includes ( message.channel.id )) {
            message.reply ( `sorry, that command is not available in this channel.` );
            return;
        }

        switch ( command ) {

            case BOT_COMMANDS.ACCOUNT: {
                await this.scheduleTransaction_openAccount ( message, tokens );
                break;
            }

            case BOT_COMMANDS.CONSENSUS: {
                await this.reportConsensusAsync ( message );
                break;
            }

            case BOT_COMMANDS.HELP: {
                message.reply ( `\`\`\`${ HELP_TEXT }\`\`\`` );
                break;
            }

            case BOT_COMMANDS.INFO: {
                message.reply ( `I am the bot that manages the ${ this.friendlyName } network. Its genesis hash is: \`\`\`${ this.genesis }\`\`\`` );
                break;
            }

            case BOT_COMMANDS.TX: {
                await this.reportTransactionsAsync ( message );
                break;
            }

            case BOT_COMMANDS.UPGRADE: {
                await this.scheduleTransaction_registerMiner ( message, tokens );
                break;
            }

            default: {
                message.reply ( `I don't recognize that command.` );
                break;
            }
        }
    }

    //----------------------------------------------------------------//
    async onReady ( message ) {
        console.log ( `Logged in as ${ this.client.user.tag }!` );
    }

    //----------------------------------------------------------------//
    async processQueueAsync () {

        // send transactions one at a time

        const row = ( this.db.prepare ( `SELECT * FROM transactions WHERE status IS 'NEW'` ).all ())[ 0 ];
        if ( !row ) return;

        let nonce = await this.findNonceAsync ();
        if ( nonce === false ) return;

        const params    = JSON.parse ( row.params );
        const envelope  = this.makeTransaction ( row.type, params, row.uuid, nonce );

        const result = await this.checkTransactionStatusAsync ( row.uuid, envelope );

        if ( result.status === TRANSACTION_STATUS.ACCEPTED ) {
            this.db.prepare ( `UPDATE transactions SET status = 'ACCEPTED' WHERE id = ?` ).run ( row.id );
            await this.notifyAcceptedAsync ( row );
        }
        else if ( result.status === TRANSACTION_STATUS.REJECTED ) {
            this.db.prepare ( `UPDATE transactions SET status = 'REJECTED' WHERE id = ?` ).run ( row.id );
            await this.notifyRejectedAsync ( row, result.message );
            return;
        }
    }

    //----------------------------------------------------------------//
    async reportConsensusAsync ( message ) {

        const consensusService = this.consensusService;
        const currentMiners = `\`\`\`${ consensusService.currentMinerIDs.join ( '\n' )}\`\`\``;
        message.reply ( `current height is ${ consensusService.height }.${ currentMiners } ` );
    }

    //----------------------------------------------------------------//
    async reportTransactionsAsync ( message ) {

        const rows = this.db.prepare ( `SELECT * FROM transactions WHERE status IS 'NEW'` ).all ();
        if ( rows.length === 0 ) {
            message.reply ( 'no unsent transactions.' );
            return;
        }

        const lines = [];
        for ( let row of rows ) {
            lines.push ( `${ row.type } ${ row.uuid }` );
        }
        const report = `\`\`\`${ lines.join ( '\n' )}\`\`\``;
        message.reply ( `${ report }` );
    }

    //----------------------------------------------------------------//
    async serviceLoop () {

        await this.processQueueAsync ();
        setTimeout (() => { this.serviceLoop ()}, SERVICE_INTERVAL );
    }

    //----------------------------------------------------------------//
    scheduleTransaction ( message, type, params ) {

        const paramString   = JSON.stringify ( params );
        const uuid          = util.generateUUIDV4 ();
        const channel       = message.channel.id; // the snowflake
        const mention       = message.author.id; // the snowflake

        this.db.prepare (`
            INSERT INTO transactions ( uuid, type, params, channel, mention ) VALUES ( ?, ?, ?, ?, ? )
        `).run ( uuid, type, paramString, channel, mention );
    }

    //----------------------------------------------------------------//
    async scheduleTransaction_openAccount ( message, tokens ) {

        const encoded = tokens.join ();

        if ( !encoded ) {
            message.reply ( `you need to give me a valid account request.` );
            return;
        }
        
        const request = vol.util.decodeAccountRequest ( encoded );

        if ( !request ) {
            message.reply ( `I could not decode that account request.` );
            return;
        }

        console.log ( 'DECODED ACCOUNT REQUEST:', request );

        if ( !request.genesis ) {
            message.reply ( `that account request is missing a genesis hash. If you are using VOLWAL, make sure it is at least verion 0.1.72.` );
            return;
        }

        if ( !request.key ) {
            message.reply ( `that account request is missing a public key. If you are using VOLWAL, make sure it is at least verion 0.1.72.` );
            return;
        }

        if ( !request.signature ) {
            message.reply ( `that account request is missing a signed ToS agreement. If you are using VOLWAL, did you see the ToS popup when you created the account request? If not, please report that as a bug.` );
            return;
        }

        if ( this.genesis !== request.genesis ) {
            message.reply ( `sorry, I don't recognize that network.` );
            return;
        }

        if ( this.checkExists ( encoded )) {
            message.reply ( `looks like that's already in my queue` );
            return false;
        }

        const params = {
            suffix:     vol.util.makeAccountSuffix (),
            key:        request.key,
            signature:  request.signature,
            grant:      0,
        }

        this.scheduleTransaction ( message, TRANSACTION_TYPE.OPEN_ACCOUNT, params );
        message.reply ( `OK, I enqueued your request for a new account on the ${ this.friendlyName } network.` );
    }

    //----------------------------------------------------------------//
    async scheduleTransaction_registerMiner ( message, tokens ) {

        let nodeURL = tokens [ 0 ];

        if ( !nodeURL ) {
            message.reply ( `you need to give me a valid node URL.` );
            return;
        }

        nodeURL = url.format ( url.parse ( nodeURL ));
        let minerID = false;

        try {
            const node = await fetchJSON ( nodeURL );
            assert ( node );

            if ( node.type !== 'VOL_MINING_NODE' ) {
                message.reply ( `I don't think that's a node.` );
                return;
            }

            if ( node.genesis !== this.genesis ) {
                message.reply ( `that looks like a node, but not one in my network.` );
                return;
            }

            if ( node.isMiner ) {
                message.reply ( `that node is already a miner.` );
                return;
            }

            minerID = node.minerID;
        }
        catch ( error ) {
            message.reply ( `I couldn't reach ${ nodeURL }; it may be offline or not a node.` );
            return;
        }

        try {

            assert ( minerID !== false );

            const accountURL = this.consensusService.getServiceURL ( `/accounts/${ minerID }` );
            const response = await fetchJSON ( accountURL );
            assert ( response );

            const account = response.account;
            
            if ( !account ) {
                message.reply ( `I couldn't find an account to upgrade named '${ minerID }'. Did you remember to rename?` );
                return;
            }
        }
        catch ( error ) {
            message.reply ( `I encountered an HTTP error trying to find an account for that node.` );
            return;
        }

        let minerInfo = false;

        try {

            const minerURL = url.parse ( nodeURL );
            minerURL.pathname = `/node`;

            const response = await fetchJSON ( url.format ( minerURL ));
            assert ( response && response.node );

            const node = response.node;

            minerInfo = {
                key:        node.publicKey,
                motto:      node.motto,
                url:        nodeURL,
                visage:     node.visage,
            };
        }
        catch ( error ) {
            message.reply ( `I couldn't fetch miner info for ${ minerID }; it may be offline or not a node.` );
            return;
        }

        if ( !minerInfo ) {
            message.reply ( `I ran into a problem finding the miner info for that node. Contact and administrator.` );
            return;
        }

        const params = {
            accountName:    minerID,
            minerInfo:      minerInfo,
        }

        this.scheduleTransaction ( message, TRANSACTION_TYPE.REGISTER_MINER, params );
        message.reply ( `OK, I enqueued your request to upgrade account ${ minerID } to a miner.` );
    }
}

const volbot = new Volbot ( true );
