#!/bin/bash
pkill -f "bash run_full.sh"
sleep 1
pkill -9 -x blender
sleep 3
echo blenders=$(pgrep -xc blender) > kill_result.txt
