/* eslint-disable no-whitespace-before-property */

import * as env from 'env';

export const RESULT_STATUS = {
    OK:     'OK',
    ERROR:  'ERROR',
};

export const VOL_NETWORK = {
    accountID:      '9090',
    genesis:        '5bde56acf2d358722cae2d24f3c8c34a276a13f1d1078cdf1f31a888380bf83d',
    friendlyName:   `Patrick's Local Test Net`,
    miners: [
        'http://localhost:9090',
        // 'https://beta.volitionccg.com',
        // 'https://volition.bulbousbouffant.com',
        // 'https://volition.tlopps.com',
        // 'https://volition.crypto-games.co.uk',
    ],
    keyfile: '.keys/key9090.priv.pem',
}
