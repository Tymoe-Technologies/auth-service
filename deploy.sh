#!/bin/bash

# ==================== Auth Service 重新部署脚本 ====================
# 用法: ./deploy.sh [build|deploy|restart|logs|clean]

set -e  # 遇到错误立即退出

SERVICE_NAME="auth-service-app"
COMPOSE_FILE="docker-compose.full.yml"
IMAGE_NAME="auth-service"
VERSION="2.2.0"  # 从 package.json 同步的版本号

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查Docker是否运行
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# 停止并删除旧服务
cleanup_old_service() {
    log_info "Cleaning up old services..."

    # 停止容器
    if docker ps -q --filter "name=${SERVICE_NAME}" | grep -q .; then
        log_info "Stopping existing container: ${SERVICE_NAME}"
        docker stop ${SERVICE_NAME} || true
    fi

    # 删除容器
    if docker ps -aq --filter "name=${SERVICE_NAME}" | grep -q .; then
        log_info "Removing existing container: ${SERVICE_NAME}"
        docker rm ${SERVICE_NAME} || true
    fi

    # 删除旧镜像 (保留最新的2个版本)
    OLD_IMAGES=$(docker images ${IMAGE_NAME} --format "table {{.ID}}" | tail -n +2 | tail -n +3)
    if [ ! -z "$OLD_IMAGES" ]; then
        log_info "Removing old images..."
        echo "$OLD_IMAGES" | xargs docker rmi -f || true
    fi

    log_success "Cleanup completed"
}

# 构建新镜像
build_image() {
    log_info "Building new Docker image..."

    # 构建镜像（带版本号和时间戳）
    docker build \
        -t ${IMAGE_NAME}:latest \
        -t ${IMAGE_NAME}:${VERSION} \
        -t ${IMAGE_NAME}:${VERSION}-$(date +%Y%m%d-%H%M%S) \
        .

    log_success "Image built successfully"
    log_info "Image tags: latest, ${VERSION}, ${VERSION}-$(date +%Y%m%d-%H%M%S)"
}

# 运行数据库迁移
run_migration() {
    log_info "Running database schema sync..."

    # 临时运行容器来同步数据库结构 (使用 db push 而不是 migrate)
    docker run --rm \
        --env-file .env \
        ${IMAGE_NAME}:latest \
        sh -c "npx prisma db push --accept-data-loss --skip-generate"

    log_success "Database schema sync completed"
}

# 部署服务
deploy_service() {
    log_info "Deploying service..."

    # 使用docker-compose启动服务
    docker-compose -f ${COMPOSE_FILE} up -d

    # 等待服务启动
    log_info "Waiting for service to start..."
    sleep 10

    # 检查服务状态
    if docker ps --filter "name=${SERVICE_NAME}" --filter "status=running" | grep -q ${SERVICE_NAME}; then
        log_success "Service deployed successfully"

        # 显示健康检查
        log_info "Checking service health..."
        sleep 5
        if curl -f http://localhost:8080/health >/dev/null 2>&1; then
            log_success "Health check passed"
        else
            log_warning "Health check failed, but service is running"
        fi
    else
        log_error "Service deployment failed"
        docker-compose -f ${COMPOSE_FILE} logs
        exit 1
    fi
}

# 显示日志
show_logs() {
    log_info "Showing service logs..."
    docker-compose -f ${COMPOSE_FILE} logs -f --tail=50
}

# 重启服务
restart_service() {
    log_info "Restarting service..."
    docker-compose -f ${COMPOSE_FILE} restart
    log_success "Service restarted"
}

# 获取SSL证书
setup_ssl() {
    log_info "Setting up SSL certificates..."

    # 检查域名是否已配置
    log_info "Please ensure tymoe.com is pointing to this server's IP address"
    read -p "Is the domain configured? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Domain not configured. Using self-signed certificate for testing..."
        setup_self_signed_cert
        return
    fi

    # 确保 nginx 运行（用于 ACME 验证）
    docker-compose -f ${COMPOSE_FILE} up -d nginx

    # 使用 certbot 申请证书
    log_info "Requesting SSL certificate from Let's Encrypt..."
    docker-compose -f ${COMPOSE_FILE} run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email admin@tymoe.com \
        --agree-tos \
        --no-eff-email \
        -d tymoe.com \
        -d www.tymoe.com

    # 检查证书是否生成成功
    if docker exec tymoe-nginx test -f /etc/letsencrypt/live/tymoe.com/fullchain.pem; then
        log_success "SSL certificates obtained successfully"
        # 重启 nginx 加载证书
        docker-compose -f ${COMPOSE_FILE} restart nginx
        # 启动 certbot 自动续期服务
        docker-compose -f ${COMPOSE_FILE} up -d certbot
    else
        log_error "Failed to obtain SSL certificates"
        log_warning "Using self-signed certificate for testing..."
        setup_self_signed_cert
    fi
}

# 创建自签名证书（仅用于测试）
setup_self_signed_cert() {
    log_info "Generating self-signed certificate..."

    docker run --rm -v certbot_conf:/etc/letsencrypt alpine sh -c "
        apk add --no-cache openssl && \
        mkdir -p /etc/letsencrypt/live/tymoe.com && \
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout /etc/letsencrypt/live/tymoe.com/privkey.pem \
            -out /etc/letsencrypt/live/tymoe.com/fullchain.pem \
            -subj '/CN=tymoe.com'
    "

    log_success "Self-signed certificate created"
    log_warning "Browser will show security warning. Use for testing only!"
}

# 完整重新部署
full_deploy() {
    log_info "Starting full redeploy with nginx and SSL..."

    check_docker
    cleanup_old_service
    build_image
    run_migration
    setup_ssl
    deploy_service

    log_success "Full deployment completed!"
    log_info "Frontend is running at: https://tymoe.com"
    log_info "API is available at: https://tymoe.com/api"
    log_info "Health check: https://tymoe.com/health"
}

# 主函数
main() {
    case "${1:-deploy}" in
        "build")
            check_docker
            build_image
            ;;
        "deploy")
            full_deploy
            ;;
        "restart")
            check_docker
            restart_service
            ;;
        "logs")
            show_logs
            ;;
        "clean")
            check_docker
            cleanup_old_service
            ;;
        "migration")
            check_docker
            run_migration
            ;;
        "ssl")
            check_docker
            setup_ssl
            ;;
        *)
            echo "Usage: $0 [build|deploy|restart|logs|clean|migration|ssl]"
            echo ""
            echo "Commands:"
            echo "  build     - Build Docker image only"
            echo "  deploy    - Full redeploy with nginx and SSL (default)"
            echo "  restart   - Restart existing service"
            echo "  logs      - Show service logs"
            echo "  clean     - Clean up old containers and images"
            echo "  migration - Run database migration only"
            echo "  ssl       - Setup SSL certificates only"
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"