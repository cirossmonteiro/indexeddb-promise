/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import zod from "zod";

import { Database } from ".";
import { objectId } from "./utils";

interface PreInsertHookEvent {
  value: object;
}

interface PostParseHookEvent {
  before: object;
  after?: object;
}

interface PostInsertHookEvent {
  value: object;
  _id: string;
}

interface IObjectStoreHooks {
  preInsert?: (event: PreInsertHookEvent) => void;
  postParse?: (event: PostParseHookEvent) => void;
  postInsert?: (event: PostInsertHookEvent) => void;
}

/* class Onebject {
  [key: string]: unknown;
  _id: string = "";
  store: ObjectStore;

  constructor(store: ObjectStore, obj: object) {
    this.store = store;
    Object.assign(this, obj);
  }

  save() {
    return this.store.update(this._id, this);
  }
} */

export class ObjectStore {
  hooks: IObjectStoreHooks = {};

  constructor(
    private db: Database,
    private name: string,
    private schema: zod.ZodObject
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterableIterator<[zod.infer<typeof this.schema>, string]> {
    const tx = this.db.db!.transaction(this.name, "readonly");
    const store = tx.objectStore(this.name);
    const request = store.openCursor();
    while (true) {
      const cursor = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });

      if (cursor) {
        try {
          const value = cursor.value as zod.infer<typeof this.schema>
          const pk = cursor.primaryKey as string
          cursor.continue();
          yield [
            value, pk
          ];
        } catch (err) {
          console.error(73, err);
        }
      } else {
        break;
      }
    }
  }

  count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.db!.transaction(this.name, "readwrite");
      const objectStore = transaction.objectStore(this.name);
      const request = objectStore.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error as Error);
    });
  }

  get(_id: string): Promise<zod.infer<typeof this.schema>|undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.db!.transaction(this.name, "readwrite");
      const objectStore = transaction.objectStore(this.name);
      const request = objectStore.get(_id);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as zod.infer<typeof this.schema>)
        } else {
          resolve(undefined);
        }
      };
      request.onerror = () => reject(request.error as Error);
    });
  }

  insert(value: zod.infer<typeof this.schema>): Promise<string> {
    if (this.hooks.preInsert) {
      this.hooks.preInsert({ value });
    }

    const statusParse = this.schema.safeParse(value);
    if (this.hooks.postParse) {
      this.hooks.postParse({
        before: value,
        after: statusParse.data
      });
    }
    
    if (statusParse.success) {
      return new Promise((resolve, reject) => {
        const _id = objectId();
        const transaction = this.db.db!.transaction(this.name, "readwrite");
        const objectStore = transaction.objectStore(this.name);
        const request = objectStore.add({ _id, ...statusParse.data });
        request.onsuccess = () => {
          if (this.hooks.postInsert) {
            this.hooks.postInsert({ value, _id });
          }
          resolve(_id);
        }
        request.onerror = () => reject(request.error as Error);
      });
    } else {
      throw new Error("Object doesn't match schema: " + statusParse.error.message);
    }
  }

  async update(_id: string, obj: zod.infer<typeof this.schema>, fullUpdate: boolean = false): Promise<void> {
    if (_id && obj?._id &&  _id !== obj?._id) {
      throw new Error("Object's _id and _id parameters MUST match.");
    }

    const exists = !!await this.get(_id);
    if (!exists) {
      throw new Error("Object with _id provided doesn't exist, then cannot be updated.");
    }

    // remove _id in order to validate its schema
    if (obj?._id) {
      delete obj._id;
    }

    if (fullUpdate) {
      const statusParse = this.schema.safeParse(obj);
      if (statusParse.success) {
        return new Promise((resolve, reject) => {
          const transaction = this.db.db!.transaction(this.name, "readwrite");
          const objectStore = transaction.objectStore(this.name);
          const request = objectStore.put({ ...obj, _id }, _id);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error as Error);
        });
      } else {
        throw new Error("Object doesn't match schema: " + statusParse.error.message);
      }
    } else { // partial update
      return new Promise((resolve, reject) => {
        const transaction = this.db.db!.transaction(this.name, "readwrite");
        const objectStore = transaction.objectStore(this.name);
        const request = objectStore.get(_id);
        request.onsuccess = () => {
          const newObj = { ...request.result, ...obj };
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (newObj?._id) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            delete newObj._id;
          }
          const statusParse = this.schema.safeParse(newObj);
          if (statusParse.success) {
            try {
              const requestUpdate = objectStore.put({ ...newObj, _id });
              requestUpdate.onsuccess = () => resolve();
              requestUpdate.onerror = () => reject(requestUpdate.error as Error);
            } catch(error) {
              reject(error as Error);
            } 
          } else {
            reject(new Error("Object doesn't match schema: " + statusParse.error.message));
          }
        };
        request.onerror = () => reject(request.error as Error);
      });
    }
  }

  forEach(
    callback: (value: zod.infer<typeof this.schema>) => Promise<void>
  ): Promise<void> {
    const transaction = this.db.db!.transaction(this.name, "readonly");
    const objectStore = transaction.objectStore(this.name);
    const request = objectStore.openCursor();
    return new Promise((resolve) => {
      request.onsuccess = async () => {
        const cursor = request.result;
        if (cursor) {
          await callback(cursor.value as zod.infer<typeof this.schema>);
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (value: zod.infer<typeof this.schema>, acc: any) => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initial: any
  ): Promise<unknown> {
    const transaction = this.db.db!.transaction(this.name, "readonly");
    const objectStore = transaction.objectStore(this.name);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let ac = initial;
    return new Promise((resolve) => {
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          ac = callback(cursor.value as zod.infer<typeof this.schema>, ac);
          cursor.continue();
        } else {
          resolve(ac);
        }
      };
    });
  }

  filter(
    callback: (value: zod.infer<typeof this.schema>) => boolean = () => true,
    limit: number = -1
  ): Promise<zod.infer<typeof this.schema>[]> {
    const transaction = this.db.db!.transaction(this.name, "readonly");
    const objectStore = transaction.objectStore(this.name);
    const result: zod.infer<typeof this.schema>[] = [];
    return new Promise((resolve) => {
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        if (limit === result.length) {
          resolve(result);
        }
        const cursor = request.result;
        if (cursor) {
          if (callback(cursor.value as zod.infer<typeof this.schema>)) {
            result.push(cursor.value as zod.infer<typeof this.schema>);
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
    });
  }

  find(
    callback: (value: zod.infer<typeof this.schema>) => boolean = () => true,
  ): Promise<zod.infer<typeof this.schema> | undefined> {
    const transaction = this.db.db!.transaction(this.name, "readonly");
    const objectStore = transaction.objectStore(this.name);
    return new Promise((resolve) => {
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (callback(cursor.value as zod.infer<typeof this.schema>)) {
            resolve(cursor.value as zod.infer<typeof this.schema>)
            return;
          }
          cursor.continue();
        } else {
          resolve(undefined);
        }
      };
    });
  }
}