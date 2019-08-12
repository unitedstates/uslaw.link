install-deps-local:
	npm install
	(cd citation && npm install)
	npm install forever

run: install-deps-local
	node_modules/forever/bin/forever -w ./server.js

docker-build: *
	sudo docker build -t joshdata/uslawdotlink .

docker-run: docker-build
	sudo docker run --name uslawdotlink -p 8000:3000 -d -it --rm joshdata/uslawdotlink

docker-stop:
	sudo docker stop uslawdotlink # because it is run with --rm, it rm's too

docker-push:
	sudo docker image push joshdata/uslawdotlink
