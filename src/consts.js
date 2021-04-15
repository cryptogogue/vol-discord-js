/* eslint-disable no-whitespace-before-property */

import * as env from 'env';

export const RESULT_STATUS = {
    OK:     'OK',
    ERROR:  'ERROR',
};

export const VOL_NETWORK = {
    accountID:      'beta',
    genesis:        '3bf3e4bd5c5dd25afb314aca5d4273f445218a815cdd5ce027d14c74328837c8',
    friendlyName:   `Volition Open Beta`,
    miners: [
        'https://beta.volitionccg.com',
        'https://volition.bulbousbouffant.com',
        'https://volition.tlopps.com',
        'https://volition.crypto-games.co.uk',
    ],
    keyfile: '.keys/beta.priv.pem',
}
