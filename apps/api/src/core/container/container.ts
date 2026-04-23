export type Constructor<T = any> = new (...args: any[]) => T;

export class Container {
  private services = new Map<Constructor, any>();

  register<T>(token: Constructor<T>, factory: (c: Container) => T) {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token.name}`);
    }

    const instance = factory(this);

    this.services.set(token, instance);
  }

  resolve<T>(token: Constructor<T>): T {
    const service = this.services.get(token);

    if (!service) {
      throw new Error(`Service not registered: ${token.name}`);
    }

    return service;
  }
}
