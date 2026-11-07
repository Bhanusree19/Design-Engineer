import { Container, getContainer } from '@cloudflare/containers';
export class DesignEngineerContainer extends Container {
  defaultPort = 4000;
  sleepAfter = '20m';
}
type Env = {BACKEND_CONTAINER: DurableObjectNamespace<DesignEngineerContainer>};
export default {
  async fetch(request:Request, env:Env):Promise<Response>{
    // STAGING ONLY: this single backend instance is not safe for multi-user code execution.
    return getContainer(env.BACKEND_CONTAINER,'deployment04-staging').fetch(request);
  }
};
