import { App, inject } from "vue";
const injectKey = "store";
export function useStore<S>(): Store<S> {
  return inject(injectKey) as any;
}
export function createStore<S>(options: StoreOptions<S>) {
  return new Store<S>(options);
}

class ModuleWrapper<S, R> {
  children: Record<string, ModuleWrapper<any, R>> = {};
  rawModule: Module<any, R>;
  state: S;
  namespaced: boolean;
  constructor(_rawModule: Module<any, R>) {
    this.rawModule = _rawModule;
    this.state = _rawModule.state || Object.create(null);
    this.namespaced = _rawModule.namespaced || false;
  }
  addChild(key: string, moduleWrapper: ModuleWrapper<any, R>) {
    this.children[key] = moduleWrapper;
  }
  getChild(key: string) {
    return this.children[key];
  }
  forEachChild(fn: ChildModuleWrapperToKey<R>) {
    Object.keys(this.children).forEach((key) => {
      fn(this.children[key], key);
    });
  }
  forEachGetter(fn: GetterToKey<R>) {
    if (this.rawModule.getters) {
      console.log("object :>> ", this.rawModule.getters);
      Util.forEachValue(this.rawModule.getters, fn);
    }
  }
  forEachMutation(fn: MutationToKey<R>) {
    if (this.rawModule.mutations) {
      Util.forEachValue(this.rawModule.mutations, fn);
    }
  }

  forEachAction(fn: ActionToKey<R>) {
    if (this.rawModule.actions) {
      Util.forEachValue(this.rawModule.actions, fn);
    }
  }
}
type GetterToKey<R> = (getters: Getter<any, R>, key: string) => any;
type ActionToKey<R> = (actions: Action<any, R>, key: string) => any;
type MutationToKey<R> = (mutation: Mutation<R>, key: string) => any;
type ChildModuleWrapperToKey<R> = (
  modulesWrapper: ModuleWrapper<any, R>,
  key: string
) => any;

function installModule<R>(
  store: Store<R>,
  rootState_: R,
  path: string[],
  module: ModuleWrapper<any, R>
) {
  const isRoot = !path.length;
  const namespace = store.moduleCollection.getNamespace(path);
  if (!isRoot) {
    const parentState: Record<string, any> = getParentState(
      rootState_,
      path.slice(0, -1)
    );
    parentState[path[path.length - 1]] = module.state;
  }
  module.forEachChild(function (child, key) {
    installModule(store, rootState_, path.concat(key), child);
  });
  module.forEachGetter(function (getter: any, key: string) {
    const namespaceType = namespace + key;
    Object.defineProperty(store.getters, namespaceType, {
      get: () => {
        return getter(module.state);
      },
    });
  });
  module.forEachMutation(function (mutation: Mutation<R>, key: string) {
    const namespaceType = namespace + key;
    store.mutations[namespaceType] = function (payload: any) {
      mutation.call(store, module.state, payload);
    };
  });
  const actionContext = makeLocalContext(store, namespace);
  module.forEachAction(function (action: Action<any, R>, key: string) {
    const namespaceType = namespace + key;
    store.actions[namespaceType] = function (payload: any) {
      action.call(
        { commit: actionContext.commit, dispatch: store.dispatch },
        payload
      );
    };
  });
}

function getParentState<R>(rootState: R, path: string[]) {
  return path.reduce((state, key) => {
    return (state as any)[key];
  }, rootState);
}

class Store<S = any> {
  moduleCollection: ModuleCollection<S>;
  mutations: Record<string, any> = {};
  actions: Record<string, any> = {};
  commit: Commit;
  getters: Record<string, any> = {};
  dispatch: Dispatch;
  constructor(options: StoreOptions<S>) {
    this.moduleCollection = new ModuleCollection<S>(options);
    const store = this;
    const { dispatch_: dispatch, commit_: commit } = this;
    this.commit = function bundCommit(type: string, payload: any) {
      commit.call(store, type, payload);
    };
    this.dispatch = function bundDispatch(type: string, payload: any) {
      dispatch.call(store, type, payload);
    };
    const rootState = this.moduleCollection.root.state;
    installModule(store, rootState, [], this.moduleCollection.root);
  }
  install(app: App) {
    app.provide(injectKey, this);
  }
  test() {
    return "wosojs";
  }
  commit_(type: string, payload: any) {
    if (!this.mutations[type]) {
      return console.error(`[vuex] unknown mutation type: ${type}`)
    }
    this.mutations[type](payload);
  }
  dispatch_(type: string, payload: any) {
    if (!this.actions[type]) {
      return console.error(`[vuex] unknown action type: ${type}`)
    }
    this.actions[type](payload);
  }
}

class ModuleCollection<R> {
  root!: ModuleWrapper<any, R>;
  constructor(rawRootModule: Module<any, R>) {
    this.register([], rawRootModule);
  }
  register(path: string[], rawModule: Module<any, R>) {
    const newModule = new ModuleWrapper<any, R>(rawModule);
    if (!path.length) {
      this.root = newModule;
    } else {
      const parentModule = this.get(path.slice(0, -1));
      parentModule.addChild(path[path.length - 1], newModule);
    }

    if (rawModule.modules) {
      const sonModules = rawModule.modules;
      Object.keys(sonModules).forEach((key) =>
        this.register(path.concat(key), sonModules[key])
      );
    }
  }
  get(path: string[]) {
    const module = this.root;
    return path.reduce((moduleWrapper: ModuleWrapper<any, R>, key: string) => {
      return moduleWrapper.getChild(key);
    }, module);
  }
  getNamespace(path: string[]) {
    let moduleWrapper = this.root;
    return path.reduce(function (namespace, key) {
      moduleWrapper = moduleWrapper.getChild(key);
      return namespace + (moduleWrapper.namespaced ? key + "/" : "");
    }, "");
  }
}

class Util {
  static forEachValue(obj: any, fn: Function) {
    Object.keys(obj).forEach((key) => {
      fn(obj[key], key);
    });
  }
}
function makeLocalContext<R>(store: Store<R>, namespace: string) {
  const noNamespace = !namespace;
  const actionContext: ActionContext<any, R> = {
    commit: noNamespace
      ? store.commit
      : function (type, payload) {
          type = namespace + type;
          store.commit(type, payload);
        },
  };
  return actionContext;
}

interface StoreOptions<S> {
  state?: S;
  getters?: GetterTree<S, S>;
  mutations?: MutationTree<S>;
  actions?: ActionTree<S, S>;
  modules?: ModuleTree<S>;
}

export interface Module<S, R> {
  namespaced?: boolean;
  state?: S;
  getters?: GetterTree<S, R>;
  mutations?: MutationTree<S>;
  actions?: ActionTree<S, S>;
  modules?: ModuleTree<R>;
}

interface GetterTree<S, R> {
  [key: string]: Getter<S, R>;
}
interface ActionTree<S, R> {
  [key: string]: Action<S, R>;
}
interface MutationTree<S> {
  [key: string]: Mutation<S>;
}
export interface ModuleTree<R> {
  [key: string]: Module<any, R>;
}

type Getter<S, R> = (
  state: S,
  getters: any,
  rootState: R,
  rootGetters: any
) => any;

interface ActionContext<S, R> {
  dispatch?: Dispatch;
  commit: Commit;
  state?: S;
}

type Dispatch = (type: string, payload?: any) => any;
type Commit = (type: string, payload?: any) => any;

type Mutation<S> = (state: S, payload?: any) => any;

type Action<S, R> = (context: ActionContext<S, R>, payload?: any) => any;
