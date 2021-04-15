/* eslint-disable no-whitespace-before-property */

import * as env from 'env';

export const RESULT_STATUS = {
    OK:     'OK',
    ERROR:  'ERROR',
};

export const VOL_MAKER = {
    gratuity:           0,
    profitShare:        0,
    transferTax:        0,
    accountName:        false,
    keyName:            'master',
    nonce:              -1,
};

export const VOL_NETWORKS = {
    openbeta: {
        accountID:      '9090',
        friendlyName:   `Patrick's Local Test Net`,
        miners: [
            'http://localhost:9090',
            // 'https://beta.volitionccg.com',
            // 'https://volition.bulbousbouffant.com',
            // 'https://volition.tlopps.com',
            // 'https://volition.crypto-games.co.uk',
        ],
        keyfile: '.keys/key9090.priv.pem',
    },
}

export const VOL_NETWORKS_BY_GENESIS = {
    [ '5bde56acf2d358722cae2d24f3c8c34a276a13f1d1078cdf1f31a888380bf83d' ]: 'openbeta',
}
