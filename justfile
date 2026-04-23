phoenix_container := "harny-phoenix"
phoenix_port := "6006"

default:
    @just --list

phoenix-up:
    @docker ps --filter name={{phoenix_container}} --format '{{{{.Names}}}}' | grep -q . \
        && echo "phoenix already running at http://127.0.0.1:{{phoenix_port}}" \
        || docker run -d --name {{phoenix_container}} -p {{phoenix_port}}:6006 arizephoenix/phoenix:latest \
        && echo "phoenix up at http://127.0.0.1:{{phoenix_port}}"

phoenix-down:
    -docker stop {{phoenix_container}}
    -docker rm {{phoenix_container}}

phoenix-logs:
    docker logs -f {{phoenix_container}}

phoenix-status:
    @docker ps --filter name={{phoenix_container}} --format 'table {{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Ports}}}}'
