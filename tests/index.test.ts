/* eslint-disable @typescript-eslint/no-explicit-any */
import { indexedDB, IDBOpenDBRequest } from 'fake-indexeddb';
import zod from "zod";

import { Database } from '../src';
import { objectId, objectIdRegex } from '../src/utils';

const NAME = "adsf";
const SCHEMA = zod.object({
  num: zod.number().optional(),
  test: zod.string()
}).strict();
// type S = zod.infer<typeof schema>;


describe('Database', () => {
  it('Utils', () => {
    expect(objectId()).toEqual(expect.stringMatching(objectIdRegex));
    expect(objectId()).not.toBe(objectId());
  });

  it('Database instance', async () => {
    const db = new Database("testdb", indexedDB);
    expect(db).toBeInstanceOf(Database);
    await db.open();
    expect(db.request).toBeInstanceOf(IDBOpenDBRequest);
    expect(db.isOpen).toBeTruthy();
    db.close();
    expect(db.isOpen).toBeFalsy();
    await db.delete();
  });

  it('ObjectStore manipulation', async () => {
    const db = new Database("testdb", indexedDB);
    await db.open();

    await db.createObjectStore(NAME, SCHEMA);
    expect(db.objectStoreNames).toEqual([NAME]);

    const store = db.objectStores[NAME];

    store.hooks.preInsert = jest.fn();
    store.hooks.postParse = jest.fn();
    store.hooks.postInsert = jest.fn();

    const _id = await store.insert({ num: 1, test: "test" });
    expect(_id).toEqual(expect.stringMatching(objectIdRegex));
    expect(store.hooks.preInsert).toHaveBeenNthCalledWith(1, { value: { num: 1, test: "test" } });
    expect(store.hooks.postParse).toHaveBeenNthCalledWith(1, { before: { num: 1, test: "test" }, after: { num: 1, test: "test" } });
    expect(store.hooks.postInsert).toHaveBeenNthCalledWith(1, { value: { num: 1, test: "test" }, _id });
    expect(await store.count()).toBe(1);

    await expect(async () => {
      await store.insert({ test2: "test" });  
    }).rejects.toThrow("Object doesn't match schema");

    await expect(async () => {
      await store.update(_id, { test2: "test2" });  
    }).rejects.toThrow("Object doesn't match schema");

    await store.update(_id, { test: "test2" });

    const obj = await store.get(_id);
    delete obj!._id;
    expect(obj).toEqual({ num: 1, test: "test2" });

    db.close();
    await db.delete();
  });

  it('ObjectStore retrieve', async () => {
    const db = new Database("testdb", indexedDB);
    await db.open();

    await db.createObjectStore(NAME, SCHEMA);
    expect(db.objectStoreNames).toEqual([NAME]);

    const store = db.objectStores[NAME];
    let index;
    for (index = 0; index < 10; index++) {
      await store.insert({ num: index, test: "test" });
    }
    expect(await store.count()).toBe(index);

    index = 0;
    for await (const [value, primaryKey] of store) {
      expect(value).toEqual({ _id: primaryKey, num: index, test: "test" });
      expect(primaryKey).toBe(value._id);
      index++;
    }

    const callback = jest.fn();
    await store.forEach(callback);
    expect(callback).toHaveBeenCalledTimes(index);

    const matched = (await store.filter()).map(v => { delete v._id; return v;});
    expect(matched).toEqual([0,1,2,3,4,5,6,7,8,9].map(num => ({ num, test: "test" })));
    
    const matched2 = (await store.filter((v: { num?: number })  => (v?.num ? v?.num >= 8 : false))).map(v => { delete v._id; return v;});
    expect(matched2).toEqual([{ num: 8, test: "test" }, { num: 9, test: "test" }]);

    const acc = await store.reduce((cv: { num?: number }, ac: number) => (cv?.num || 0) + ac, 0);
    expect(acc).toBe([0,1,2,3,4,5,6,7,8,9].reduce((v, ac) => v+ac, 0));

    const found = await store.find((v: { num?: number })  => v.num == 3);
    delete found!._id;
    expect(found).toEqual({ num: 3, test: "test" });

    const notFound = await store.find((v: { num?: number })  => (v.num ? v.num > 9 : false));
    expect(notFound).toBeUndefined();

    db.close();
    await db.delete();
  });

  it('ObjectStore schema migration', async () => {
    const db = new Database("testdb", indexedDB);
    await db.open();
    await db.createObjectStore(NAME, SCHEMA);
    const store = db.objectStores[NAME];
    for (let index = 0; index < 10; index++) {
      await store.insert({ num: index, test: "test" });
    }

    await db.createObjectStore("adsf2", zod.object({
      num: zod.number().optional(),
      test2: zod.string()
    }).strict());
    const store2 = db.objectStores.adsf2;
    await store.forEach(async (value) => {
      await store2.insert({
        num: value.num,
        test2: value.test
      });
    });
    let index = 0;
    for await (const [value, primaryKey] of store2) {
      expect(value).toEqual({ _id: primaryKey, num: index, test2: "test" });
      expect(primaryKey).toBe(value._id);
      index++;
    }
    await db.deleteObjectStore("adsf2");

    db.close();
    await db.delete();
  });
});
