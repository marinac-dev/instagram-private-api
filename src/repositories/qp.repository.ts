import { Repository } from '../core/repository';

export class QpRepository extends Repository {
  public async getCooldowns() {
    return this.client.request.send({
      url: '/api/v1/qp/get_cooldowns/',
      qs: this.client.request.sign({}),
    });
  }
  public async batchFetch() {
    return this.client.request.send({
      url: '/api/v1/qp/batch_fetch/',
      method: 'POST',
      form: this.client.request.sign({
        surfaces_to_triggers: this.surfacesToTriggers,
        surfaces_to_queries: this.surfacesToQueries,
        vc_policy: 'default',
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        scale: '3',
        version: '1',
      }),
    });
  }
  public get surfacesToQueries(): string {
    return this.client.state.constants.QP_SURFACES_TO_QUERIES;
  }
  public get surfacesToTriggers(): string {
    return this.client.state.constants.QP_SURFACES_TO_TRIGGERS;
  }
}
