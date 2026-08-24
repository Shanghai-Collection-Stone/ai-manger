import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * @description 创建 SuperClaw gRPC 微服务启动配置
 * @keyword-cn gRPC启动配置, 节点监听
 * @keyword-en grpc-bootstrap-options, node-listener
 */
export function createSuperClawGrpcOptions(): MicroserviceOptions {
  return {
    transport: Transport.GRPC,
    options: {
      package: 'superclaw.v1',
      protoPath: resolveSuperClawProtoPath(),
      url: process.env.SUPER_CLAW_GRPC_URL?.trim() || '0.0.0.0:50051',
      loader: {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    },
  };
}

/**
 * @description 兼容源码和编译产物布局解析 SuperClaw proto 路径
 * @keyword-cn 协议路径, 运行时布局
 * @keyword-en proto-path, runtime-layout
 */
function resolveSuperClawProtoPath(): string {
  const sourcePath = join(
    process.cwd(),
    'src',
    'modules',
    'super-claw',
    'proto',
    'super-claw.proto',
  );
  return existsSync(sourcePath)
    ? sourcePath
    : join(__dirname, 'proto', 'super-claw.proto');
}
