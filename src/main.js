/* eslint-disable no-whitespace-before-property */

process.on ( 'uncaughtException', function ( err ) {
    console.log ( err );
    process.exit ( 1 );
});

import sqlite3                      from 'better-sqlite3';
import * as consts                  from 'consts';
import Discord                      from 'discord.js';
import * as env                     from 'env';
import { crypto, util }             from 'fgc';
import fs                           from 'fs';
import fetch                       from 'node-fetch';
import url                          from 'url';
import { vol }                      from 'vol';
import _                            from 'lodash';

// https://discord.js.org/#/

const BOT_PREFIX = 'volbot,'

const BOT_COMMANDS = {
    ACCOUNT:                'account',
    UPGRADE:                'upgrade',
}

const SERVICE_INTERVAL = 5000;

const TRANSACTION_STATUS = {
    NEW:                'NEW',
    PENDING:            'PENDING',
    ACCEPTED:           'ACCEPTED',
    REJECTED:           'REJECTED',
    INCOMPLETE:         'INCOMPLETE',
}

const TRANSACTION_TYPE = {
    OPEN_ACCOUNT:       'OPEN_ACCOUNT',
    REGISTER_MINER:     'REGISTER_MINER',
}

//----------------------------------------------------------------//
function fetchJSON ( endpoint, init ) {
    return fetch ( endpoint, init ).then ( res => res.json ());
}

//================================================================//
// Volbot
//================================================================//
class Volbot {

    //----------------------------------------------------------------//
    checkExists ( networkID, paramString ) {

        const exists = this.db.prepare ( `SELECT id FROM transactions WHERE network IS ? AND params IS ?` ).get ( networkID, paramString );
        return Boolean ( exists );
    }

    //----------------------------------------------------------------//
    async checkTransactionStatusAsync ( networkID, row ) {

        const network = this.networks [ networkID ];

        const checkStatus = async ( nodeURL ) => {

            try {

                let accountURL          = url.parse ( nodeURL );
                accountURL.pathname     = `/accounts/${ network.accountID }/transactions/${ row.uuid }`;
                accountURL              = url.format ( accountURL );

                const result            = await fetchJSON ( accountURL );
                result.url              = accountURL;

                return result;
            }
            catch ( error ) {
                console.log ( error );
            }
            return false;
        }

        const putTransaction = async ( nodeURL ) => {

            let result = false;

            try {
                result = await fetchJSON ( nodeURL, {
                    method :    'PUT',
                    headers :   { 'content-type': 'application/json' },
                    body :      row.envelope,
                });
            }
            catch ( error ) {
                console.log ( 'error or no response' );
                console.log ( error );
            }

            return ( result && ( result.status === 'OK' ));
        }

        const promises = [];
        for ( let nodeURL of network.miners ) {
            promises.push ( checkStatus ( nodeURL ));
        }
        const results = await Promise.all ( promises );

        let resultCount     = 0;
        let acceptedCount   = 0;

        for ( let result of results ) {

            if ( !result ) continue;
            resultCount++;

            console.log ( 'processTransaction RESULT', result );

            switch ( result.status ) {

                case 'ACCEPTED':
                    acceptedCount++;
                    break;

                case 'REJECTED':
                    if ( result.uuid === row.uuid ) return TRANSACTION_STATUS.REJECTED;
                    putTransaction ( result.url );
                    break;

                case 'UNKNOWN':
                    putTransaction ( result.url );
                    break;

                default:
                    break;
            }
        }

        return ( acceptedCount === resultCount ) ? TRANSACTION_STATUS.ACCEPTED : TRANSACTION_STATUS.PENDING;
    }

    //----------------------------------------------------------------//
    async connect ( login ) {

        this.networks = _.cloneDeep ( consts.VOL_NETWORKS );

        for ( let networkID in this.networks ) {
            const network = this.networks [ networkID ];
            const phraseOrPEM = fs.readFileSync ( network.keyfile, 'utf8' );
            network.key = await crypto.loadKeyAsync ( phraseOrPEM );
        }

        this.db = new sqlite3 ( 'sqlite.db' );

        this.db.prepare (`
            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER         PRIMARY KEY,
                network         TEXT            NOT NULL,
                uuid            TEXT            NOT NULL,
                type            TEXT            NOT NULL,
                status          TEXT            NOT NULL DEFAULT 'NEW',
                params          TEXT            NOT NULL,
                nonce           INTEGER         NOT NULL DEFAULT 0,
                envelope        TEXT            NOT NULL DEFAULT '',
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

        this.serviceLoop ();
    }

    //----------------------------------------------------------------//
    constructor ( login ) {
        this.connect ( login );
    }

    //----------------------------------------------------------------//
    async findNonceAsync ( networkID ) {

        const network = this.networks [ networkID ];

        const getNonce = async ( nodeURL ) => {

            try {

                const accountURL        = url.parse ( nodeURL );
                accountURL.pathname     = `/accounts/${ network.accountID }`;
                let result              = await fetchJSON ( url.format ( accountURL ));

                return result && result.account && result.account.nonce;
            }
            catch ( error ) {
                console.log ( error );
            }
            return false;
        }

        const promises = [];
        for ( let nodeURL of network.miners ) {
            promises.push ( getNonce ( nodeURL ));
        }
        const results = await Promise.all ( promises );

        if ( !results.length ) return false;

        const nonce = results [ 0 ];

        for ( let result of results ) {
            if ( result !== nonce ) return false;
        }
        return nonce;
    }

    //----------------------------------------------------------------//
    makeTransaction ( type, networkID, params, uuid, nonce ) {

        const network = this.networks [ networkID ];
                if ( !network ) return false;

        let body = false;

        const maker = _.cloneDeep ( consts.VOL_MAKER );
        maker.accountName = network.accountID;

        switch ( type ) {

            case TRANSACTION_TYPE.OPEN_ACCOUNT: {

                const request = vol.decodeAccountRequest ( params.encoded );

                body = {
                    type:       type,
                    uuid:       uuid,
                    suffix:     params.suffix,
                    key:        request.key,
                    grant:      0,
                    maker:      maker,
                };

                break;
            }

            case TRANSACTION_TYPE.REGISTER_MINER: {
                break;
            }
        }

        if ( !body ) return;

        return vol.signTransaction ( network.key, body, nonce );
    }

    //----------------------------------------------------------------//
    async notifyAcceptedAsync ( networkID, row ) {

        const network = this.networks [ networkID ];

        if ( !( row.channel && row.mention )) return;
        const channel = await this.client.channels.fetch ( row.channel );
        if ( !channel ) return;

        const params = JSON.parse ( row.params );

        switch ( row.type ) {

            case TRANSACTION_TYPE.OPEN_ACCOUNT: {
                const accountName = `.${ network.accountID }.${ params.suffix }`;
                channel.send ( `Fantastic news, <@${ row.mention }>! Your transaction of type ${ row.type } was ACCEPTED! Your new account is named: ${ accountName }` );
                break;
            }

            case TRANSACTION_TYPE.REGISTER_MINER: {
                break;
            }
        }
    }

    //----------------------------------------------------------------//
    async onMessage ( message ) {

        if ( message.author.bot ) return;
        if ( !message.content.length ) return;

        const content       = message.content;

        const tokens        = content.split ( ' ' );
        const prefix        = tokens.shift ().toLowerCase ();
        
        if ( prefix != BOT_PREFIX ) return;

        if ( message.channel.name !== 'volbot' ) {
            message.reply ( `sorry, I only do stuff for people in the #volbot channel.` );
        }

        const command       = tokens.shift ().toLowerCase ();

        switch ( command ) {

            case BOT_COMMANDS.ACCOUNT: {
                this.scheduleTransaction_openAccount ( message, tokens );
                break;
            }

            case BOT_COMMANDS.UPGRADE: {
                this.scheduleTransaction_registerMiner ( message, tokens );
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

        for ( let networkID in this.networks ) {
            await this.processQueueAsync_newTransactions ( networkID );
            await this.processQueueAsync_pendingTransactions ( networkID );
        }
    }

    //----------------------------------------------------------------//
    async processQueueAsync_newTransactions ( networkID ) {

        // get all NEW transactions
        //      if NEW transactions, find the nonce (all miners agree)
        //      if no nonce, skip
        //      prepare envelopes and update to PENDING

        const network = this.networks [ networkID ];

        const rows = this.db.prepare ( `SELECT * FROM transactions WHERE network IS ? AND status IS 'NEW'` ).all ( networkID );
        if ( rows.length === 0 ) return;

        let nonce = await this.findNonceAsync ( networkID );
        if ( nonce === false ) return;

        for ( let row of rows ) {
            const params = JSON.parse ( row.params );
            const envelope = this.makeTransaction ( row.type, networkID, params, row.uuid, nonce++ );

            this.db.prepare (`
                UPDATE transactions SET status = 'PENDING', envelope = ? WHERE id = ?
            `).run ( JSON.stringify ( envelope ), row.id );
        }
    }

    //----------------------------------------------------------------//
    async processQueueAsync_pendingTransactions ( networkID ) {

        // get all PENDING transactions
        //      check status with all miners
        //      if any UNKNOWN, resubmit
        //      if all ACCEPTED, mark as ACCEPTED
        //      if any REJECTED, mark REJECTED then reset all PENDING to NEW

        const rows = this.db.prepare ( `SELECT * FROM transactions WHERE network IS ? AND status IS 'PENDING'` ).all ( networkID );
        if ( rows.length === 0 ) return;

        for ( let row of rows ) {

            const status = await this.checkTransactionStatusAsync ( networkID, row );

            if ( status === TRANSACTION_STATUS.ACCEPTED ) {
                this.db.prepare ( `UPDATE transactions SET status = 'ACCEPTED' WHERE id = ?` ).run ( row.id );
                await this.notifyAcceptedAsync ( networkID, row );
            }
            else if ( status === TRANSACTION_STATUS.REJECTED ) {
                this.db.prepare ( `UPDATE transactions SET status = 'REJECTED' WHERE id = ?` ).run ( row.id );
                this.db.prepare ( `UPDATE transactions SET status = 'PENDING' WHERE status = 'NEW'` );
                return;
            }
        }
    }

    //----------------------------------------------------------------//
    async serviceLoop () {

        await this.processQueueAsync ();
        setTimeout (() => { this.serviceLoop ()}, SERVICE_INTERVAL );
    }

    //----------------------------------------------------------------//
    scheduleTransaction ( message, networkID, type, params ) {

        const paramString   = JSON.stringify ( params );
        const uuid          = util.generateUUIDV4 ();
        const channel       = message.channel.id; // the snowflake
        const mention       = message.author.id; // the snowflake

        this.db.prepare (`
            INSERT INTO transactions ( network, uuid, type, params, channel, mention ) VALUES ( ?, ?, ?, ?, ?, ? )
        `).run ( networkID, uuid, type, paramString, channel, mention );
    }

    //----------------------------------------------------------------//
    scheduleTransaction_openAccount ( message, tokens ) {

        const encoded = tokens.join ();
        const request = vol.decodeAccountRequest ( encoded );

        if ( !request ) {
            message.reply ( `I could not decode that account request.` );
            return;
        }

        console.log ( 'DECODED ACCOUNT REQUEST:', request );

        if ( !request.genesis ) {
            message.reply ( `that account request is missing a genesis hash. Try again.` );
            return;
        }

        if ( !request.key ) {
            message.reply ( `that account request is missing a public key. Try again.` );
            return;
        }

        const networkID = consts.VOL_NETWORKS_BY_GENESIS [ request.genesis ];
        const network = this.networks [ networkID ];

        if ( !network ) {
            message.reply ( `sorry, I don't recognize that network.` );
            console.log ( 'UNKNOWN NETWORK', networkID );
            console.log ( 'FOR GENESIS:', request.genesis );
            return;
        }

        if ( this.checkExists ( networkID, encoded )) {
            message.reply ( `looks like that's already in my queue` );
            return false;
        }

        const params = {
            suffix: vol.makeAccountSuffix (),
            encoded: encoded,
        }

        this.scheduleTransaction ( message, networkID, TRANSACTION_TYPE.OPEN_ACCOUNT, params );
        message.reply ( `OK, I enqueued your request for a new account on the ${ network.friendlyName } network.` );
    }

    //----------------------------------------------------------------//
    scheduleTransaction_registerMiner ( message, tokens ) {

        // const encoded = tokens.join ();
        // const request = vol.decodeAccountRequest ( encoded );

        // if ( !request ) {
        //     message.reply ( `I could not decode that account request.` );
        //     return;
        // }

        // console.log ( 'DECODED ACCOUNT REQUEST:', request );

        // if ( !request.genesis ) {
        //     message.reply ( `that account request is missing a genesis hash. Try again.` );
        //     return;
        // }

        // if ( !request.key ) {
        //     message.reply ( `that account request is missing a public key. Try again.` );
        //     return;
        // }

        // const networkID = consts.VOL_NETWORKS_BY_GENESIS [ request.genesis ];
        // const network = this.networks [ networkID ];

        // if ( !network ) {
        //     message.reply ( `sorry, I don't recognize that network.` );
        //     console.log ( 'UNKNOWN NETWORK', networkID );
        //     console.log ( 'FOR GENESIS:', request.genesis );
        //     return;
        // }

        // if ( this.checkExists ( networkID, encoded )) {
        //     message.reply ( `looks like that's already in my queue` );
        //     return false;
        // }

        // const params = {
        //     suffix: vol.makeAccountSuffix (),
        //     encoded: encoded,
        // }

        // this.scheduleTransaction ( message, networkID, TRANSACTION_TYPE.OPEN_ACCOUNT, params );
        // message.reply ( `OK, I enqueued your request for a new account on the ${ network.friendlyName } network.` );
    }
}

const volbot = new Volbot ( true );
