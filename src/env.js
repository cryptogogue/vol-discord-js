/* eslint-disable no-whitespace-before-property */

import { assert }                   from 'fgc';
import _                            from 'lodash';

//----------------------------------------------------------------//
function getEnv ( name, fallback ) {
    const value = _.has ( process.env, name ) ? process.env [ name ] : fallback;
    assert ( value !== undefined, `Missing ${ name } environment variable.` );
    return value;
}

export const BOT_TOKEN                          = getEnv ( 'BOT_TOKEN' )
