import zod from "zod";

import { ObjectStore } from "./objectStore";

interface IDatabaseOpenOptions {
  reOpen?: boolean;
  incrementVersion?: boolean;
  newObjectStore?: {
    name: string;
    schema: zod.ZodObject;
  };
  deleteObjectStore?: string;
}

export class Database {
  request?: IDBOpenDBRequest;
  db?: IDBDatabase;
  isOpen: boolean = false;
  version: number = 1;
  objectStoreNames: string[] = [];
  objectStores: Record<string, ObjectStore> = {};

  constructor(
    private dbname: string,
    private factory?: IDBFactory
  ) {
    this.factory = factory ?? globalThis.indexedDB;

    if (!this.factory) {
      throw new Error("IndexedDB not available in this environment");
    }
  }

  open(options?: IDatabaseOpenOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (options?.reOpen) {
        this.close();
      }

      if (options?.incrementVersion) {
        this.version++;
      }

      this.request = this.factory!.open(this.dbname, this.version);

      this.request.onupgradeneeded = () => {
        if (options?.newObjectStore) {
          this.request!.result.createObjectStore(options.newObjectStore.name, { keyPath: "_id" });
          this.objectStores[options.newObjectStore.name] = new ObjectStore(
            this,
            options.newObjectStore.name,
            options.newObjectStore.schema
          );
        }

        if (options?.deleteObjectStore) {
          this.request!.result.deleteObjectStore(options.deleteObjectStore);
        }
      }

      this.request.onsuccess = () => {
        this.db = this.request!.result;
        this.isOpen = true;
        this.objectStoreNames = [...this.db.objectStoreNames];
        resolve();
      }

      this.request.onerror = () => reject(this.request!.error as Error);
    });
  }

  close(): void {
    (this.db as IDBDatabase).close();
    this.isOpen = false;
  }

  delete(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = this.factory!.deleteDatabase(this.dbname);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error as Error);
      };
    });
  }

  deleteObjectStore(storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.open({ 
        reOpen: true,
        incrementVersion: true,
        deleteObjectStore: storeName
      }).then(resolve).catch(reject);
    });
  }

  createObjectStore(storeName: string, schema: zod.ZodObject): Promise<void> {
    return new Promise((resolve, reject) => {
      this.open({ 
        reOpen: true,
        incrementVersion: true,
        newObjectStore: {
          name: storeName,
          schema
        }
      }).then(resolve).catch(reject);
    });
  }
}