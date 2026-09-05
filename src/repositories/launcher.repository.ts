import { Repository } from '../core/repository';

export class LauncherRepository extends Repository {
  public async preLoginSync() {
    return this.sync({
      id: this.client.state.uuid,
      configs: this.client.state.constants.LAUNCHER_PRELOGIN_CONFIGS,
    });
  }
  public async postLoginSync() {
    const uid = this.client.state.cookieUserId;
    return this.sync({
      _csrftoken: this.client.state.cookieCsrfToken,
      id: uid,
      _uid: uid,
      _uuid: this.client.state.uuid,
      configs: this.client.state.constants.LAUNCHER_POSTLOGIN_CONFIGS,
    });
  }
  public async sync(data: object) {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/launcher/sync/',
      form: this.client.request.sign(data),
    });
    return body;
  }
}
