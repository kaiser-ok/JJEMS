package main

import "testing"

func TestDecodeRegisters(t *testing.T) {
	tests := []struct {
		name     string
		regs     []uint16
		typeName string
		want     float64
	}{
		{name: "u16", regs: []uint16{380}, typeName: "u16", want: 380},
		{name: "i16 positive", regs: []uint16{123}, typeName: "i16", want: 123},
		{name: "i16 negative", regs: []uint16{0xffff}, typeName: "i16", want: -1},
		{name: "u32 big words", regs: []uint16{0x0001, 0x0002}, typeName: "u32_be_words", want: 65538},
		{name: "i32 big words negative", regs: []uint16{0xffff, 0xffff}, typeName: "i32_be_words", want: -1},
		{name: "u32 little words", regs: []uint16{0x0002, 0x0001}, typeName: "u32_le_words", want: 65538},
		{name: "i32 little words negative", regs: []uint16{0xffff, 0xffff}, typeName: "i32_le_words", want: -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeRegisters(tt.regs, tt.typeName)
			if err != nil {
				t.Fatalf("decodeRegisters returned error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("decodeRegisters = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDecodeRegistersUnsupported(t *testing.T) {
	_, err := decodeRegisters([]uint16{1}, "bad")
	if err == nil {
		t.Fatal("decodeRegisters returned nil error for unsupported type")
	}
}
