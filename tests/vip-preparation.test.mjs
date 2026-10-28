import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareVip} from '../worker/vip-preparation.mjs';

test('prepare only the unfinished VIP without enabling purchases or changing other products',()=>{
 const config={version:7,products:[{id:'vip',price:.01,commands:[],draft:false,benefits:['Existing benefit']},{id:'nova',price:20}]};
 const next=prepareVip(config);
 assert.equal(next.version,8);assert.equal(next.products[0].price,29.9);
 assert.equal(next.products[0].duration,'30 dias');assert.equal(next.products[0].draft,true);
 assert.deepEqual(next.products[0].commands,[]);assert.deepEqual(next.products[0].benefits,['Existing benefit']);
 assert.deepEqual(next.products[1],config.products[1]);assert.equal(config.products[0].price,.01);
 assert.equal(prepareVip(next),null);
 assert.equal(prepareVip({...config,products:[{id:'vip',price:50,commands:[]}]}),null);
 assert.equal(prepareVip({...config,products:[{id:'vip',price:.01,commands:['custom {player}']}]}),null);
 assert.equal(prepareVip({...config,products:[]}),null);
});
