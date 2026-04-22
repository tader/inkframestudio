declare module "pngjs" {
  export class PNG {
    static sync: {
      write(png: PNG): Buffer;
    };

    data: Buffer;

    constructor(options: { width: number; height: number });
  }
}
