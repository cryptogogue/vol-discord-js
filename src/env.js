/* eslint-disable no-whitespace-before-property */

import { assert }                   from 'fgc';
import _                            from 'lodash';

//----------------------------------------------------------------//
function getEnv ( name, fallback ) {
    const value = _.has ( process.env, name ) ? process.env [ name ] : fallback;
    assert ( value !== undefined, `Missing ${ name } environment variable.` );
    return value;
}

export const PORT                               = parseInt ( getEnv ( 'PORT', 7777 ), 10 );

export const MYSQL_HOST                         = getEnv ( 'MYSQL_HOST' )
export const MYSQL_DATABASE                     = getEnv ( 'MYSQL_DATABASE' )
export const MYSQL_USER                         = getEnv ( 'MYSQL_USER' )
export const MYSQL_PASSWORD                     = getEnv ( 'MYSQL_PASSWORD' )

export const BOT_TOKEN                          = getEnv ( 'BOT_TOKEN' )
